"use client";

import { MessageSquareText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function AICopilotPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Copilot</h1>
        <p className="text-muted-foreground">
          Your AI-powered compensation intelligence assistant.
        </p>
      </div>
      <EmptyState
        icon={MessageSquareText}
        title="AI Copilot Coming Soon"
        description="Ask questions about compensation data, get policy recommendations, analyze pay equity, and more — all through natural language conversation."
      />
    </div>
  );
}

