"use client";

import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function TotalRewardsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Total Rewards Statement</h1>
        <p className="text-muted-foreground">
          Your complete compensation and benefits overview.
        </p>
      </div>
      <EmptyState
        icon={BarChart3}
        title="No Compensation Data Yet"
        description="Import employee compensation data to generate total rewards statements, market comparisons, and team analytics."
        actionLabel="Import Data"
        actionHref="/dashboard/data-hygiene/import"
      />
    </div>
  );
}