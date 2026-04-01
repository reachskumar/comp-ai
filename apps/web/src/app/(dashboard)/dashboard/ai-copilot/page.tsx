'use client';

import { useRef, useEffect, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopilotChart, parseChartBlock, extractText } from '@/components/copilot-chart';
import {
  MessageSquareText,
  Send,
  Square,
  Trash2,
  Bot,
  User,
  Loader2,
  Sparkles,
  History,
  Plus,
  CheckCircle2,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  useCopilot,
  useConversationHistory,
  type ChatMessage,
  type ToolCallInfo,
} from '@/hooks/use-copilot';

const SUGGESTED_PROMPTS = [
  'How many employees do we have?',
  "What's the average salary by department?",
  'Show me the latest compensation cycle',
  'Are there any active payroll anomalies?',
  'What compensation rules are currently active?',
  "Show me my team's comp ratios",
  'What benefits plans are available?',
  'Any pending recommendations to approve?',
];

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
  approve_recommendation: 'Approving recommendation',
  reject_recommendation: 'Rejecting recommendation',
  request_letter: 'Generating letter',
};

export default function AICopilotPage() {
  const {
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
  } = useCopilot();

  const {
    conversations,
    isLoading: historyLoading,
    fetchConversations,
    deleteConversation,
  } = useConversationHistory();

  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Load conversation history when sidebar opens
  useEffect(() => {
    if (sidebarOpen) void fetchConversations();
  }, [sidebarOpen, fetchConversations]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    void sendMessage(input);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
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
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleNewChat = () => {
    clearChat();
    setSidebarOpen(false);
  };

  const handleLoadConversation = (convId: string) => {
    void loadConversation(convId);
    setSidebarOpen(false);
  };

  const isEmpty = messages.length === 0 && !isRestoring;

  // Build status text
  let statusText = 'Ask anything about your compensation data';
  if (isRestoring) {
    statusText = 'Restoring conversation…';
  } else if (isStreaming) {
    if (activeTool) {
      statusText = TOOL_LABELS[activeTool] ?? `Using ${activeTool}…`;
    } else if (activeNode === 'tools') {
      statusText = 'Querying data…';
    } else {
      statusText = 'Thinking…';
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)]">
      {/* Conversation Sidebar */}
      {sidebarOpen && (
        <div className="w-72 shrink-0 border-r flex flex-col bg-muted/30">
          <div className="flex items-center justify-between px-3 py-3 border-b">
            <h2 className="text-sm font-semibold">Conversations</h2>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewChat}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : conversations.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  No conversations yet
                </p>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => handleLoadConversation(conv.id)}
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent group ${
                      conversationId === conv.id ? 'bg-accent' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate font-medium">
                        {conv.title ?? 'New conversation'}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteConversation(conv.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {conv._count.messages} messages
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(conv.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => setSidebarOpen(true)}
              >
                <History className="h-4 w-4" />
              </Button>
            )}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/10">
              <MessageSquareText className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">AI Copilot</h1>
              <p className="text-xs text-muted-foreground">{statusText}</p>
            </div>
          </div>
          <div className="flex gap-1">
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearChat}>
                <Plus className="mr-1 h-4 w-4" />
                New Chat
              </Button>
            )}
          </div>
        </div>

        {/* Messages Area */}
        <ScrollArea ref={scrollRef} className="flex-1 px-4 py-4">
          {isEmpty ? (
            <WelcomeScreen onPromptClick={(p) => void sendMessage(p)} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} isStreaming={isStreaming} />
              ))}
              {isStreaming && activeTool && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground pl-12">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {TOOL_LABELS[activeTool] ?? `Running ${activeTool}…`}
                </div>
              )}
              {error && (
                <div className="mx-auto max-w-3xl rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t border-border/60 bg-background/50 backdrop-blur-sm px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Card className="flex flex-1 items-end overflow-hidden p-0 rounded-xl border-border/60 shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder="Ask a compensation question…"
                disabled={isStreaming}
                rows={1}
                className="flex-1 resize-none border-0 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
            </Card>
            {isStreaming ? (
              <Button
                size="icon"
                variant="destructive"
                onClick={stopStreaming}
                className="h-10 w-10 rounded-xl shrink-0"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim()}
                className="h-10 w-10 rounded-xl shrink-0 shadow-sm shadow-primary/20"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

function WelcomeScreen({ onPromptClick }: { onPromptClick: (p: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 py-16">
      <div className="relative">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 dark:from-indigo-500/20 dark:to-violet-500/20">
          <Sparkles className="h-10 w-10 text-primary" />
        </div>
        <div className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-green-500 border-2 border-background" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">AI Compensation Copilot</h2>
        <p className="text-muted-foreground max-w-md text-base leading-relaxed">
          Ask questions about employees, salaries, compensation cycles, payroll, and rules — powered
          by your live data.
        </p>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 max-w-2xl">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPromptClick(prompt)}
            className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm px-4 py-3 text-left text-sm transition-all duration-150 hover:bg-accent hover:border-primary/20 hover:shadow-sm group"
          >
            <span className="group-hover:text-primary transition-colors">{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolCallIndicator({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  if (!toolCalls.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {toolCalls.map((tc, i) => (
        <Badge
          key={`${tc.name}-${i}`}
          variant={tc.status === 'done' ? 'secondary' : 'outline'}
          className="text-[10px] gap-1 py-0"
        >
          {tc.status === 'running' ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : tc.isAction ? (
            <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />
          ) : (
            <Wrench className="h-2.5 w-2.5" />
          )}
          {TOOL_LABELS[tc.name] ?? tc.name}
        </Badge>
      ))}
    </div>
  );
}

function ActionConfirmBanner({ message }: { message: string }) {
  return (
    <div className="mt-2 rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-3 py-2 text-sm flex items-center gap-2">
      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
      <span className="text-green-800 dark:text-green-200">{message}</span>
    </div>
  );
}

function MessageBubble({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <Avatar className="h-8 w-8 shrink-0 mt-0.5 ring-2 ring-primary/10">
          <AvatarFallback className="bg-gradient-to-br from-primary/15 to-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
      <div className={`max-w-[80%] ${isUser ? '' : 'min-w-0'}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm ${
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-md shadow-sm shadow-primary/20'
              : 'bg-muted/80 border border-border/40 rounded-bl-md'
          }`}
        >
          {message.content ? (
            isUser ? (
              <span className="whitespace-pre-wrap">{message.content}</span>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const lang = match?.[1];
                      const codeStr = extractText(children).replace(/\n$/, '');
                      if (lang === 'chart') {
                        const chartConfig = parseChartBlock(codeStr);
                        if (chartConfig) {
                          return <CopilotChart config={chartConfig} />;
                        }
                      }
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
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking…
            </span>
          )}
        </div>
        {/* Tool call indicators */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallIndicator toolCalls={message.toolCalls} />
        )}
        {/* Action confirmation banner */}
        {!isUser && message.actionResult?.success && (
          <ActionConfirmBanner message={message.actionResult.message} />
        )}
      </div>
      {isUser && (
        <Avatar className="h-8 w-8 shrink-0 mt-0.5">
          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary font-semibold">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
