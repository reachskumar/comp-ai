"use client";

import { useState } from "react";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronDown,
  ChevronRight,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ComplianceFindingItem {
  id: string;
  category: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  description: string;
  explanation: string | null;
  remediation: string | null;
  affectedScope: Record<string, unknown>;
  resolved: boolean;
}

interface ComplianceFindingsListProps {
  findings: ComplianceFindingItem[];
  className?: string;
}

const severityConfig = {
  CRITICAL: {
    icon: AlertCircle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    badge: "destructive" as const,
    label: "Critical",
  },
  WARNING: {
    icon: AlertTriangle,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    badge: "outline" as const,
    label: "Warning",
  },
  INFO: {
    icon: Info,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    badge: "secondary" as const,
    label: "Info",
  },
};

const categoryLabels: Record<string, string> = {
  FLSA_OVERTIME: "FLSA Overtime",
  PAY_EQUITY: "Pay Equity",
  POLICY_VIOLATION: "Policy Violation",
  BENEFITS_ELIGIBILITY: "Benefits Eligibility",
  REGULATORY_GAP: "Regulatory Gap",
  DATA_QUALITY: "Data Quality",
};

export function ComplianceFindingsList({
  findings,
  className,
}: ComplianceFindingsListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (findings.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-12 text-muted-foreground", className)}>
        <Info className="h-8 w-8 mb-2" />
        <p className="text-sm">No findings to display</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {findings.map((finding) => {
        const config = severityConfig[finding.severity];
        const Icon = config.icon;
        const isExpanded = expandedId === finding.id;

        return (
          <Card
            key={finding.id}
            className={cn("overflow-hidden border", config.border)}
          >
            <button
              onClick={() => setExpandedId(isExpanded ? null : finding.id)}
              className="flex w-full items-start gap-3 p-3 text-left hover:bg-accent/50 transition-colors"
            >
              <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", config.color)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{finding.title}</span>
                  <Badge variant={config.badge} className="text-[10px] px-1.5 py-0">
                    {config.label}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {categoryLabels[finding.category] ?? finding.category}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  {finding.description}
                </p>
              </div>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>

            {isExpanded && (
              <div className={cn("border-t px-4 py-3 space-y-3", config.bg)}>
                <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                    What&apos;s Wrong
                  </h4>
                  <p className="text-sm">{finding.description}</p>
                </div>
                {finding.explanation && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                      Why It Matters
                    </h4>
                    <p className="text-sm">{finding.explanation}</p>
                  </div>
                )}
                {finding.remediation && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                      How to Fix
                    </h4>
                    <p className="text-sm">{finding.remediation}</p>
                  </div>
                )}
                {Object.keys(finding.affectedScope).length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                      Affected Scope
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {JSON.stringify(finding.affectedScope)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

