"use client";

import { useCallback, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";

const API_BASE_URL = process.env["NEXT_PUBLIC_API_URL"] || "http://localhost:4000";

// ─── Types ───────────────────────────────────────────────

export interface ReportColumn {
  key: string;
  label: string;
  type?: string;
}

export interface ReportChartConfig {
  type: "bar" | "pie" | "line" | "table";
  xKey?: string;
  yKey?: string;
  groupKey?: string;
}

export interface ReportResult {
  title: string;
  queryType?: string;
  data: Record<string, unknown>[];
  columns: ReportColumn[];
  chartConfig: ReportChartConfig;
  narrative: string;
}

export interface SavedReport {
  id: string;
  title: string;
  prompt: string;
  status: string;
  queryType?: string;
  results: unknown;
  chartConfig: unknown;
  narrative?: string;
  createdAt: string;
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

export function useReports() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamedContent, setStreamedContent] = useState("");
  const [report, setReport] = useState<ReportResult | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const generateReport = useCallback(
    async (prompt: string, conversationId?: string) => {
      if (!prompt.trim() || isStreaming) return;

      setError(null);
      setStreamedContent("");
      setReport(null);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token =
          typeof window !== "undefined"
            ? localStorage.getItem("accessToken")
            : null;

        const res = await fetch(`${API_BASE_URL}/api/v1/reports/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            prompt: prompt.trim(),
            ...(conversationId ? { conversationId } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6)) as SSEData;
                if (currentEvent === "message:chunk" && data.content) {
                  fullContent += data.content;
                  setStreamedContent(fullContent);
                } else if (currentEvent === "node:start") {
                  setActiveNode((data.node as string) ?? null);
                } else if (currentEvent === "node:end") {
                  setActiveNode(null);
                } else if (currentEvent === "error") {
                  setError((data.message as string) ?? "Unknown error");
                }
              } catch {
                // skip malformed JSON
              }
              currentEvent = "";
            }
          }
        }

        // Try to parse the final content as structured report JSON
        tryParseReport(fullContent);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        setIsStreaming(false);
        setActiveNode(null);
        abortRef.current = null;
      }
    },
    [isStreaming],
  );

  const tryParseReport = (content: string) => {
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
        content.match(/\{[\s\S]*"title"[\s\S]*"data"[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : content;
      const parsed = JSON.parse(jsonStr) as ReportResult;
      if (parsed.title && parsed.data) {
        setReport(parsed);
      }
    } catch {
      // Content is plain text narrative — that's ok
    }
  };

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const saveReport = useCallback(
    async (data: {
      title: string; prompt: string; queryType?: string;
      filters?: Record<string, unknown>; results?: unknown;
      chartConfig?: Record<string, unknown>; narrative?: string;
    }) => {
      return apiClient.fetch<SavedReport>("/api/v1/reports/save", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    [],
  );

  const loadSavedReports = useCallback(async () => {
    try {
      const list = await apiClient.fetch<SavedReport[]>("/api/v1/reports");
      setSavedReports(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reports");
    }
  }, []);

  const exportReport = useCallback(
    async (id: string, format: string) => {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("accessToken")
          : null;
      const res = await fetch(`${API_BASE_URL}/api/v1/reports/${id}/export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ format }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const clearReport = useCallback(() => {
    setStreamedContent("");
    setReport(null);
    setError(null);
  }, []);

  return {
    isStreaming,
    activeNode,
    error,
    streamedContent,
    report,
    savedReports,
    generateReport,
    stopStreaming,
    saveReport,
    loadSavedReports,
    exportReport,
    clearReport,
  };
}

