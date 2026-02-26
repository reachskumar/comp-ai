'use client';

import { useRef, useEffect, useState, type KeyboardEvent } from 'react';
import {
  FileText,
  Send,
  Square,
  Trash2,
  Bot,
  User,
  Loader2,
  Sparkles,
  Upload,
  X,
  FileUp,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  usePolicyDocuments,
  usePolicyChat,
  useUploadPolicyMutation,
  useDeletePolicyMutation,
  type PolicyChatMessage,
  type PolicyDocument,
} from '@/hooks/use-policy-rag';

const SUGGESTED_PROMPTS = [
  'What is our merit increase policy?',
  'What are the equity vesting rules?',
  'How does our bonus structure work?',
  'What is the policy on salary bands?',
  'Summarize our compensation philosophy',
];

export default function AIPoliciesPage() {
  const { data: docsData } = usePolicyDocuments();
  const uploadMutation = useUploadPolicyMutation();
  const deleteMutation = useDeletePolicyMutation();
  const { messages, isStreaming, activeNode, error, askQuestion, stopStreaming, clearChat } =
    usePolicyChat();

  const [input, setInput] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    void askQuestion(input);
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
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    uploadMutation.mutate({
      title: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      content,
      mimeType: file.type || 'text/plain',
    });
    setShowUpload(false);
  };

  const docs = docsData?.data ?? [];
  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-[calc(100vh-8rem)]">
      {/* Left sidebar — Documents */}
      <div className="w-72 border-r flex flex-col">
        <div className="flex items-center justify-between border-b px-3 py-3">
          <h2 className="text-sm font-semibold">Policy Documents</h2>
          <Button size="sm" variant="outline" onClick={() => setShowUpload(!showUpload)}>
            <Upload className="h-3 w-3 mr-1" />
            Upload
          </Button>
        </div>

        {showUpload && (
          <div className="border-b p-3">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors">
              <FileUp className="h-6 w-6" />
              <span>Drop a .txt or .pdf file</span>
              <input
                type="file"
                accept=".txt,.pdf,.md"
                className="hidden"
                onChange={(e) => void handleFileUpload(e)}
              />
            </label>
            {uploadMutation.isPending && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Processing…
              </div>
            )}
          </div>
        )}

        <ScrollArea className="flex-1">
          {docs.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No policies uploaded yet.
              <br />
              Upload a document to get started.
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {docs.map((doc) => (
                <DocCard key={doc.id} doc={doc} onDelete={(id) => deleteMutation.mutate(id)} />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right side — Chat */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Policy AI</h1>
              <p className="text-xs text-muted-foreground">
                {isStreaming
                  ? activeNode === 'tools'
                    ? 'Searching policies…'
                    : 'Thinking…'
                  : `Ask questions about your ${docs.length} uploaded policies`}
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

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1 px-4 py-4">
          {isEmpty ? (
            <WelcomeScreen
              onPromptClick={(p) => void askQuestion(p)}
              hasDocuments={docs.length > 0}
            />
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {isStreaming && activeNode === 'tools' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground pl-12">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Searching your policies…
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

        {/* Input */}
        <div className="border-t px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Card className="flex flex-1 items-end overflow-hidden p-0">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your company policies…"
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
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

function DocCard({ doc, onDelete }: { doc: PolicyDocument; onDelete: (id: string) => void }) {
  const statusIcon =
    doc.status === 'READY' ? (
      <CheckCircle2 className="h-3 w-3 text-green-500" />
    ) : doc.status === 'PROCESSING' ? (
      <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
    ) : doc.status === 'FAILED' ? (
      <AlertCircle className="h-3 w-3 text-red-500" />
    ) : null;

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{doc.title}</div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {statusIcon}
          <span>{doc.chunkCount} chunks</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100"
        onClick={() => onDelete(doc.id)}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function WelcomeScreen({
  onPromptClick,
  hasDocuments,
}: {
  onPromptClick: (p: string) => void;
  hasDocuments: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 py-16">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold">Policy AI Assistant</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-md">
          {hasDocuments
            ? 'Ask questions about your company policies — answers are grounded in your uploaded documents with citations.'
            : 'Upload your compensation policy documents first, then ask questions to get AI-powered answers with citations.'}
        </p>
      </div>
      {hasDocuments && (
        <div className="grid gap-2 sm:grid-cols-2">
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
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: PolicyChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
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
