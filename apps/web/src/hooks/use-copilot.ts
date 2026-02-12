"use client";

import { useCallback, useRef, useState } from "react";

const API_BASE_URL = process.env["NEXT_PUBLIC_API_URL"] || "http://localhost:4000";

// ─── Types ───────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface SSEData {
  content?: string;
  node?: string;
  message?: string;
  graphName?: string;
  runId?: string | null;
  timestamp?: number;
  [key: string]: unknown;
}

// ─── Hook ────────────────────────────────────────────────

export function useCopilot() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || isStreaming) return;

      setError(null);

      // Append user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      // Prepare assistant placeholder
      const assistantId = `assistant-${Date.now()}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token =
          typeof window !== "undefined"
            ? localStorage.getItem("accessToken")
            : null;

        const res = await fetch(`${API_BASE_URL}/api/v1/copilot/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            message: message.trim(),
            ...(conversationId ? { conversationId } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6)) as SSEData;
                handleSSEEvent(currentEvent, data, assistantId);
              } catch {
                // skip malformed JSON
              }
              currentEvent = "";
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setError(msg);
          // Update assistant message with error
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || "Sorry, something went wrong." }
                : m,
            ),
          );
        }
      } finally {
        setIsStreaming(false);
        setActiveNode(null);
        abortRef.current = null;
      }
    },
    [isStreaming, conversationId],
  );

  const handleSSEEvent = useCallback(
    (eventType: string, data: SSEData, assistantId: string) => {
      switch (eventType) {
        case "graph:start":
          if (data.runId && typeof data.runId === "string") {
            setConversationId(data.runId);
          }
          break;
        case "node:start":
          setActiveNode((data.node as string) ?? null);
          break;
        case "node:end":
          setActiveNode(null);
          break;
        case "message:chunk":
          if (data.content) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + data.content }
                  : m,
              ),
            );
          }
          break;
        case "error":
          setError((data.message as string) ?? "Unknown error");
          break;
        case "graph:end":
          // streaming done
          break;
      }
    },
    [],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  return {
    messages,
    isStreaming,
    activeNode,
    conversationId,
    error,
    sendMessage,
    stopStreaming,
    clearChat,
  };
}

