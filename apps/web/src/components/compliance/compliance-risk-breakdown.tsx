"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface RiskSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  byCategory: Record<string, number>;
  riskLevel: string;
}

interface ComplianceRiskBreakdownProps {
  riskSummary: RiskSummary | null;
  className?: string;
}

const categoryLabels: Record<string, string> = {
  FLSA_OVERTIME: "FLSA Overtime",
  PAY_EQUITY: "Pay Equity",
  POLICY_VIOLATION: "Policy Violation",
  BENEFITS_ELIGIBILITY: "Benefits Eligibility",
  REGULATORY_GAP: "Regulatory Gap",
  DATA_QUALITY: "Data Quality",
};

const categoryColors: Record<string, string> = {
  FLSA_OVERTIME: "bg-purple-500",
  PAY_EQUITY: "bg-blue-500",
  POLICY_VIOLATION: "bg-orange-500",
  BENEFITS_ELIGIBILITY: "bg-teal-500",
  REGULATORY_GAP: "bg-red-500",
  DATA_QUALITY: "bg-yellow-500",
};

export function ComplianceRiskBreakdown({
  riskSummary,
  className,
}: ComplianceRiskBreakdownProps) {
  if (!riskSummary) {
    return (
      <Card className={cn("p-4", className)}>
        <p className="text-sm text-muted-foreground text-center py-4">
          Run a compliance scan to see risk breakdown
        </p>
      </Card>
    );
  }

  const maxCategory = Math.max(...Object.values(riskSummary.byCategory), 1);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Severity Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 border-red-500/30">
          <div className="text-2xl font-bold text-red-500">{riskSummary.critical}</div>
          <div className="text-xs text-muted-foreground">Critical</div>
        </Card>
        <Card className="p-3 border-yellow-500/30">
          <div className="text-2xl font-bold text-yellow-500">{riskSummary.warning}</div>
          <div className="text-xs text-muted-foreground">Warnings</div>
        </Card>
        <Card className="p-3 border-blue-500/30">
          <div className="text-2xl font-bold text-blue-500">{riskSummary.info}</div>
          <div className="text-xs text-muted-foreground">Info</div>
        </Card>
      </div>

      {/* Category Breakdown */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Findings by Category</h3>
        <div className="space-y-2">
          {Object.entries(riskSummary.byCategory).map(([category, count]) => (
            <div key={category} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-32 shrink-0 truncate">
                {categoryLabels[category] ?? category}
              </span>
              <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    categoryColors[category] ?? "bg-gray-500"
                  )}
                  style={{ width: `${(count / maxCategory) * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

