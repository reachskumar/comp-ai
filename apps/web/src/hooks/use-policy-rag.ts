'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';

// ─── Types ───────────────────────────────────────────────

export interface PolicyDocument {
  id: string;
  tenantId: string;
  title: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  chunkCount: number;
  uploadedBy: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyChatMessage {
  id: string;
  role: 'user' | 'assistant';
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

// ─── Document Hooks ──────────────────────────────────────

export function usePolicyDocuments(filters?: { status?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);

  return useQuery<{ data: PolicyDocument[]; total: number }>({
    queryKey: ['policy-documents', filters],
    queryFn: () => apiClient.fetch(`/api/v1/policies?${params}`),
  });
}

export function useUploadPolicyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; fileName: string; content: string; mimeType?: string }) =>
      apiClient.fetch<PolicyDocument>('/api/v1/policies/upload', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['policy-documents'] });
    },
  });
}

export function useDeletePolicyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.fetch<void>(`/api/v1/policies/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['policy-documents'] });
    },
  });
}

// ─── Chat Hook ───────────────────────────────────────────

export function usePolicyChat() {
  const [messages, setMessages] = useState<PolicyChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const askQuestion = useCallback(
    async (question: string) => {
      if (!question.trim() || isStreaming) return;
      setError(null);

      const userMsg: PolicyChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: question.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      const assistantId = `assistant-${Date.now()}`;
      const assistantMsg: PolicyChatMessage = {
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

        const res = await fetch(`${API_BASE_URL}/api/v1/policies/ask`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            question: question.trim(),
            ...(conversationId ? { conversationId } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Request failed: ${res.status}`);

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6)) as SSEData;
                switch (currentEvent) {
                  case 'graph:start':
                    if (data.runId && typeof data.runId === 'string') {
                      setConversationId(data.runId);
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
                  case 'error':
                    setError((data.message as string) ?? 'Unknown error');
                    break;
                }
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
    askQuestion,
    stopStreaming,
    clearChat,
  };
}
