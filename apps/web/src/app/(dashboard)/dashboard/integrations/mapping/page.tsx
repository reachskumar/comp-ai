"use client";

import { useState } from "react";
import { ArrowRight, Sparkles, Check, X, Loader2, ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  useConnectorTemplates,
  useFieldMappingSuggestions,
  type SuggestedMapping,
  type ConnectorTemplate,
} from "@/hooks/use-integrations";

function confidenceColor(c: number) {
  if (c >= 0.8) return "text-green-600 dark:text-green-400";
  if (c >= 0.5) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function confidenceBg(c: number) {
  if (c >= 0.8) return "bg-green-100 dark:bg-green-900";
  if (c >= 0.5) return "bg-yellow-100 dark:bg-yellow-900";
  return "bg-red-100 dark:bg-red-900";
}

export default function FieldMappingPage() {
  const { data: templates } = useConnectorTemplates();
  const suggest = useFieldMappingSuggestions();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [rejected, setRejected] = useState<Set<number>>(new Set());

  function handleSuggest(templateId: string) {
    setSelectedTemplate(templateId);
    setAccepted(new Set());
    setRejected(new Set());
    suggest.mutate({ templateId });
  }

  function toggleAccept(idx: number) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
    setRejected((prev) => { const next = new Set(prev); next.delete(idx); return next; });
  }

  function toggleReject(idx: number) {
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
    setAccepted((prev) => { const next = new Set(prev); next.delete(idx); return next; });
  }

  const suggestions = suggest.data?.suggestions ?? [];
  const overallConfidence = suggest.data?.overallConfidence ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Field Mapping</h1>
          <p className="text-muted-foreground">
            AI-powered field mapping suggestions with confidence scores.
          </p>
        </div>
        {suggest.data && (
          <div className="text-right">
            <p className="text-sm font-medium">Overall Confidence</p>
            <p className={`text-2xl font-bold ${confidenceColor(overallConfidence)}`}>
              {Math.round(overallConfidence * 100)}%
            </p>
          </div>
        )}
      </div>

      {/* Template Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Select a Connector to Map
          </CardTitle>
          <CardDescription>
            Choose a connector template and AI will suggest optimal field mappings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(templates ?? []).map((t) => (
              <Button
                key={t.id}
                variant={selectedTemplate === t.id ? "default" : "outline"}
                size="sm"
                onClick={() => handleSuggest(t.id)}
                disabled={suggest.isPending}
              >
                {suggest.isPending && selectedTemplate === t.id && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                )}
                {t.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {suggest.isPending && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
          <p className="text-sm text-muted-foreground">AI is analyzing schemas...</p>
        </div>
      )}

      {/* Mapping Results */}
      {suggest.data && suggestions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Suggested Mappings ({suggestions.length})
            </h2>
            <div className="flex gap-2 text-sm text-muted-foreground">
              <span className="text-green-600">{accepted.size} accepted</span>
              <span className="text-red-600">{rejected.size} rejected</span>
              <span>{suggestions.length - accepted.size - rejected.size} pending</span>
            </div>
          </div>

          <Progress
            value={((accepted.size + rejected.size) / suggestions.length) * 100}
            className="h-2"
          />

          <div className="space-y-2">
            {suggestions.map((m, idx) => (
              <Card
                key={idx}
                className={
                  accepted.has(idx) ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-950/20" :
                  rejected.has(idx) ? "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/20 opacity-60" : ""
                }
              >
                <CardContent className="flex items-center gap-4 py-3">
                  {/* Source field */}
                  <div className="min-w-[180px]">
                    <p className="text-sm font-medium font-mono">{m.sourceField}</p>
                  </div>

                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

                  {/* Target field */}
                  <div className="min-w-[180px]">
                    <p className="text-sm font-medium font-mono">{m.targetField}</p>
                  </div>

                  {/* Confidence */}
                  <div className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBg(m.confidence)} ${confidenceColor(m.confidence)}`}>
                    {Math.round(m.confidence * 100)}%
                  </div>

                  {/* Transform */}
                  <Badge variant="outline" className="text-xs shrink-0">
                    {m.transformType}
                  </Badge>

                  {/* Reasoning */}
                  <p className="text-xs text-muted-foreground flex-1 truncate" title={m.reasoning}>
                    {m.reasoning}
                  </p>

                  {/* Accept/Reject buttons */}
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant={accepted.has(idx) ? "default" : "ghost"}
                      className="h-7 w-7 p-0"
                      onClick={() => toggleAccept(idx)}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant={rejected.has(idx) ? "destructive" : "ghost"}
                      className="h-7 w-7 p-0"
                      onClick={() => toggleReject(idx)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Unmapped fields */}
          {((suggest.data.unmappedSource?.length ?? 0) > 0 ||
            (suggest.data.unmappedTarget?.length ?? 0) > 0) && (
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Unmapped Fields</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                {(suggest.data.unmappedSource?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Source (no target match)</p>
                    <div className="flex flex-wrap gap-1">
                      {suggest.data.unmappedSource!.map((f) => (
                        <Badge key={f} variant="outline" className="text-xs font-mono">{f}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {(suggest.data.unmappedTarget?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Target (no source match)</p>
                    <div className="flex flex-wrap gap-1">
                      {suggest.data.unmappedTarget!.map((f) => (
                        <Badge key={f} variant="outline" className="text-xs font-mono">{f}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Error state */}
      {suggest.isError && (
        <Card className="border-red-300">
          <CardContent className="py-4">
            <p className="text-sm text-red-600">
              Failed to get mapping suggestions: {suggest.error?.message}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

