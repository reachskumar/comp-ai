"use client";

import { useRef, useEffect, useState, type KeyboardEvent } from "react";
import {
  MessageSquareText,
  Send,
  Square,
  Trash2,
  Bot,
  User,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useCopilot, type ChatMessage } from "@/hooks/use-copilot";

const SUGGESTED_PROMPTS = [
  "How many employees do we have?",
  "What's the average salary by department?",
  "Show me the latest compensation cycle",
  "Are there any active payroll anomalies?",
  "What compensation rules are currently active?",
];

export default function AICopilotPage() {
  const {
    messages,
    isStreaming,
    activeNode,
    error,
    sendMessage,
    stopStreaming,
    clearChat,
  } = useCopilot();

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    void sendMessage(input);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <MessageSquareText className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">AI Copilot</h1>
            <p className="text-xs text-muted-foreground">
              {isStreaming
                ? activeNode === "tools"
                  ? "Querying data…"
                  : "Thinking…"
                : "Ask anything about your compensation data"}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat}>
            <Trash2 className="mr-1 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      {/* Messages Area */}
      <ScrollArea ref={scrollRef} className="flex-1 px-4 py-4">
        {isEmpty ? (
          <WelcomeScreen onPromptClick={(p) => void sendMessage(p)} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isStreaming && activeNode === "tools" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground pl-12">
                <Loader2 className="h-3 w-3 animate-spin" />
                Querying your data…
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
      <div className="border-t px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Card className="flex flex-1 items-end overflow-hidden p-0">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask a compensation question…"
              disabled={isStreaming}
              rows={1}
              className="flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </Card>
          {isStreaming ? (
            <Button size="icon" variant="destructive" onClick={stopStreaming}>
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={handleSend} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── Sub-components ─────────────────────────────────────

function WelcomeScreen({ onPromptClick }: { onPromptClick: (p: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 py-16">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold">AI Compensation Copilot</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-md">
          Ask questions about employees, salaries, compensation cycles, payroll,
          and rules — powered by your live data.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPromptClick(prompt)}
            className="rounded-lg border bg-card px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        }`}
      >
        {message.content || (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Thinking…
          </span>
        )}
      </div>
      {isUser && (
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback>
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
