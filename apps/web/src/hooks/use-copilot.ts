'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCsrfToken } from '@/lib/csrf';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';

// ─── Persistence Keys ─────────────────────────────────────
const STORAGE_KEY_CONV_ID = 'copilot:activeConversationId';
const STORAGE_KEY_PANEL_OPEN = 'copilot:panelOpen';
const STORAGE_KEY_PANEL_WIDTH = 'copilot:panelWidth';

function getStoredConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY_CONV_ID);
}

function storeConversationId(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) {
    localStorage.setItem(STORAGE_KEY_CONV_ID, id);
  } else {
    localStorage.removeItem(STORAGE_KEY_CONV_ID);
  }
}

// ─── Types ───────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  actionResult?: ActionResult;
}

export interface ToolCallInfo {
  name: string;
  isAction: boolean;
  status: 'running' | 'done';
}

export interface ActionResult {
  tool: string;
  message: string;
  success: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

interface SSEData {
  content?: string;
  node?: string;
  tool?: string;
  isAction?: boolean;
  message?: string;
  graphName?: string;
  runId?: string | null;
  result?: Record<string, unknown>;
  timestamp?: number;
  [key: string]: unknown;
}

// ─── Hook ────────────────────────────────────────────────

export function useCopilot(options?: { autoRestore?: boolean }) {
  const { autoRestore = true } = options ?? {};
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);

  // Auto-restore last conversation on mount
  useEffect(() => {
    if (!autoRestore || restoredRef.current) return;
    restoredRef.current = true;

    const storedId = getStoredConversationId();
    if (!storedId) return;

    setIsRestoring(true);
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    fetch(`${API_BASE_URL}/api/v1/copilot/conversations/${storedId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) {
          storeConversationId(null);
          return;
        }
        const conv = (await res.json()) as {
          id: string;
          messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
        };
        setConversationId(conv.id);
        setMessages(
          conv.messages.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
          })),
        );
      })
      .catch(() => {
        storeConversationId(null);
      })
      .finally(() => {
        setIsRestoring(false);
      });
  }, [autoRestore]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || isStreaming) return;

      setError(null);

      // Append user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      // Prepare assistant placeholder
      const assistantId = `assistant-${Date.now()}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

        const csrfToken = await getCsrfToken();
        const res = await fetch(`${API_BASE_URL}/api/v1/copilot/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          },
          credentials: 'include',
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
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6)) as SSEData;
                handleSSEEvent(currentEvent, data, assistantId);
              } catch {
                // skip malformed JSON
              }
              currentEvent = '';
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setError(msg);
          // Update assistant message with error
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || 'Sorry, something went wrong.' }
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

  const handleSSEEvent = useCallback((eventType: string, data: SSEData, assistantId: string) => {
    switch (eventType) {
      case 'graph:start':
        if (data.runId && typeof data.runId === 'string') {
          setConversationId(data.runId);
          storeConversationId(data.runId);
        }
        break;
      case 'node:start':
        setActiveNode((data.node as string) ?? null);
        break;
      case 'node:end':
        setActiveNode(null);
        break;
      case 'message:chunk':
        if (data.content) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + data.content } : m,
            ),
          );
        }
        break;
      case 'tool:start':
        setActiveTool((data.tool as string) ?? null);
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const toolCalls = [...(m.toolCalls ?? [])];
            toolCalls.push({
              name: (data.tool as string) ?? 'unknown',
              isAction: !!data.isAction,
              status: 'running',
            });
            return { ...m, toolCalls };
          }),
        );
        break;
      case 'tool:end':
        setActiveTool(null);
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const toolCalls = (m.toolCalls ?? []).map((tc) =>
              tc.name === data.tool && tc.status === 'running'
                ? { ...tc, status: 'done' as const }
                : tc,
            );
            return { ...m, toolCalls };
          }),
        );
        break;
      case 'action:confirm':
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            return {
              ...m,
              actionResult: {
                tool: (data.tool as string) ?? '',
                message: (data.message as string) ?? '',
                success: !!(data.result as Record<string, unknown>)?.success,
              },
            };
          }),
        );
        break;
      case 'error':
        setError((data.message as string) ?? 'Unknown error');
        break;
      case 'graph:end':
        // streaming done
        break;
    }
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    storeConversationId(null);
    setError(null);
  }, []);

  const loadConversation = useCallback(async (convId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const res = await fetch(`${API_BASE_URL}/api/v1/copilot/conversations/${convId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const conv = (await res.json()) as {
      id: string;
      messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
    };
    setConversationId(conv.id);
    storeConversationId(conv.id);
    setMessages(
      conv.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.createdAt).getTime(),
      })),
    );
  }, []);

  return {
    messages,
    isStreaming,
    isRestoring,
    activeNode,
    activeTool,
    conversationId,
    error,
    sendMessage,
    stopStreaming,
    clearChat,
    loadConversation,
  };
}

// ─── Conversation History Hook ─────────────────────────────

export function useConversationHistory() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const res = await fetch(`${API_BASE_URL}/api/v1/copilot/conversations?limit=50`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const body = (await res.json()) as { data: ConversationSummary[] };
        setConversations(body.data ?? []);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const csrfToken = await getCsrfToken();
    const res = await fetch(`${API_BASE_URL}/api/v1/copilot/conversations/${id}`, {
      method: 'DELETE',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      credentials: 'include',
    });
    if (res.ok) {
      setConversations((prev) => prev.filter((c) => c.id !== id));
    }
  }, []);

  return { conversations, isLoading, fetchConversations, deleteConversation };
}
