"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ScoreHistoryPoint {
  id: string;
  overallScore: number | null;
  completedAt: string;
}

interface ComplianceScoreTrendProps {
  history: ScoreHistoryPoint[];
  className?: string;
}

export function ComplianceScoreTrend({ history, className }: ComplianceScoreTrendProps) {
  if (history.length === 0) {
    return (
      <Card className={cn("p-4", className)}>
        <p className="text-sm text-muted-foreground text-center py-8">
          No score history available yet
        </p>
      </Card>
    );
  }

  // Reverse so oldest first (API returns newest first)
  const data = [...history].reverse().map((h) => ({
    date: h.completedAt
      ? new Date(h.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "N/A",
    score: h.overallScore ?? 0,
  }));

  return (
    <Card className={cn("p-4", className)}>
      <h3 className="text-sm font-semibold mb-3">Score Trend</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.5} />
          <ReferenceLine y={60} stroke="#eab308" strokeDasharray="3 3" strokeOpacity={0.5} />
          <Line
            type="monotone"
            dataKey="score"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 3, fill: "hsl(var(--primary))" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

