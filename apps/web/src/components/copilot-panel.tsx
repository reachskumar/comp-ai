'use client';

import { useRef, useEffect, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MessageSquareText,
  Send,
  Square,
  X,
  Bot,
  User,
  Loader2,
  Sparkles,
  GripVertical,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useCopilot, type ChatMessage, type ToolCallInfo } from '@/hooks/use-copilot';
import { CopilotChart, parseChartBlock } from '@/components/copilot-chart';

const STORAGE_KEY_PANEL_WIDTH = 'copilot:panelWidth';

const TOOL_LABELS: Record<string, string> = {
  query_employees: 'Searching employees',
  query_compensation: 'Looking up compensation',
  query_rules: 'Checking rules',
  query_cycles: 'Querying cycles',
  query_payroll: 'Checking payroll',
  query_analytics: 'Running analytics',
  query_benefits: 'Looking up benefits',
  query_equity: 'Checking equity grants',
  query_salary_bands: 'Checking salary bands',
  query_notifications: 'Fetching notifications',
  query_team: 'Loading team data',
  query_performance_analytics: 'Analyzing performance data',
  approve_recommendation: 'Approving recommendation',
  reject_recommendation: 'Rejecting recommendation',
  request_letter: 'Generating letter',
};

interface CopilotPanelProps {
  open: boolean;
  onClose: () => void;
  /** Optional pre-filled message to send on open (e.g., from a nudge "Ask Copilot" button) */
  initialMessage?: string;
}

export function CopilotPanel({ open, onClose, initialMessage }: CopilotPanelProps) {
  const {
    messages,
    isStreaming,
    isRestoring,
    activeTool,
    error,
    sendMessage,
    stopStreaming,
    clearChat,
  } = useCopilot();

  const [input, setInput] = useState('');
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return 400;
    const stored = localStorage.getItem(STORAGE_KEY_PANEL_WIDTH);
    return stored ? Math.max(320, Math.min(600, parseInt(stored, 10))) : 400;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizingRef = useRef(false);
  const sentInitialRef = useRef(false);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Send initial message if provided
  useEffect(() => {
    if (open && initialMessage && !sentInitialRef.current) {
      sentInitialRef.current = true;
      void sendMessage(initialMessage);
    }
  }, [open, initialMessage, sendMessage]);

  // Reset sent flag when panel closes
  useEffect(() => {
    if (!open) sentInitialRef.current = false;
  }, [open]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    void sendMessage(input);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  // Drag-to-resize
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startX - ev.clientX;
      const newWidth = Math.max(320, Math.min(600, startWidth + delta));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      localStorage.setItem(STORAGE_KEY_PANEL_WIDTH, String(width));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  if (!open) return null;

  const isEmpty = messages.length === 0 && !isRestoring;

  return (
    <div
      className="hidden lg:flex h-full flex-col border-l border-border/60 bg-background"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 z-10"
        onMouseDown={handleResizeStart}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60 bg-background/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">AI Copilot</h2>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
              {isStreaming
                ? activeTool
                  ? (TOOL_LABELS[activeTool] ?? 'Working…')
                  : 'Thinking…'
                : isRestoring
                  ? 'Restoring…'
                  : 'Ready'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={clearChat}
              title="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            title="Close panel"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 px-3 py-3">
        {isEmpty ? (
          <PanelWelcome onPromptClick={(p) => void sendMessage(p)} />
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <PanelMessage key={msg.id} message={msg} />
            ))}
            {isStreaming && activeTool && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pl-8">
                <Loader2 className="h-3 w-3 animate-spin" />
                {TOOL_LABELS[activeTool] ?? `Running ${activeTool}…`}
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border/60 px-3 py-2">
        <div className="flex items-end gap-1.5">
          <Card className="flex flex-1 items-end overflow-hidden p-0 rounded-lg border-border/60 shadow-sm focus-within:ring-1 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask about compensation…"
              disabled={isStreaming}
              rows={1}
              className="flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </Card>
          {isStreaming ? (
            <Button
              size="icon"
              variant="destructive"
              onClick={stopStreaming}
              className="h-8 w-8 shrink-0"
            >
              <Square className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim()}
              className="h-8 w-8 shrink-0"
            >
              <Send className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

const PANEL_PROMPTS = [
  "What's the average compa-ratio for my team?",
  'Are there any pay equity issues?',
  'Suggest optimal merit increases within budget',
  'Show salary band coverage by department',
];

function PanelWelcome({ onPromptClick }: { onPromptClick: (p: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <div className="text-center space-y-1">
        <h3 className="text-sm font-semibold">AI Copilot</h3>
        <p className="text-xs text-muted-foreground max-w-[250px]">
          Ask questions about your compensation data while you work.
        </p>
      </div>
      <div className="w-full space-y-1.5">
        {PANEL_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPromptClick(prompt)}
            className="w-full rounded-lg border border-border/60 bg-card/80 px-3 py-2 text-left text-xs transition-all hover:bg-accent hover:border-primary/20 group"
          >
            <span className="group-hover:text-primary transition-colors">{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <Avatar className="h-6 w-6 shrink-0 mt-0.5">
          <AvatarFallback className="bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-primary">
            <Bot className="h-3 w-3" />
          </AvatarFallback>
        </Avatar>
      )}
      <div className={`max-w-[85%] ${isUser ? '' : 'min-w-0'}`}>
        <div
          className={`rounded-xl px-3 py-2 text-xs ${
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-muted/80 border border-border/40 rounded-bl-sm'
          }`}
        >
          {message.content ? (
            isUser ? (
              <span className="whitespace-pre-wrap">{message.content}</span>
            ) : (
              <div className="prose prose-xs dark:prose-invert max-w-none [&_table]:text-[10px] [&_th]:px-1.5 [&_td]:px-1.5 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const lang = match?.[1];
                      const codeStr = String(children).replace(/\n$/, '');
                      if (lang === 'chart') {
                        const chartConfig = parseChartBlock(codeStr);
                        if (chartConfig) {
                          return <CopilotChart config={chartConfig} />;
                        }
                      }
                      // Default code rendering
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    pre({ children }) {
                      return <>{children}</>;
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking…
            </span>
          )}
        </div>
        {/* Tool call indicators */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.toolCalls.map((tc, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {tc.status === 'running' ? (
                  <Loader2 className="mr-0.5 h-2 w-2 animate-spin" />
                ) : null}
                {TOOL_LABELS[tc.name] ?? tc.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <Avatar className="h-6 w-6 shrink-0 mt-0.5">
          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary text-[10px]">
            <User className="h-3 w-3" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
