"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

export interface MarketComparisonItem {
  label: string;
  value: number;
  percentile: number;
  color: string;
}

interface HorizontalBarChartProps {
  data: MarketComparisonItem[];
  employeePercentile: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: MarketComparisonItem }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
      <p className="text-sm font-medium">{item.label}</p>
      <p className="text-sm text-muted-foreground">
        ${item.value.toLocaleString()} ({item.percentile}th percentile)
      </p>
    </div>
  );
}

export function HorizontalBarChart({ data, employeePercentile }: HorizontalBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 60, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <YAxis type="category" dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} width={55} />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine
          x={data.find((d) => d.percentile === employeePercentile)?.value}
          stroke="#2FA84F"
          strokeWidth={2}
          strokeDasharray="4 4"
          label={{ value: "You", position: "top", fill: "#2FA84F", fontSize: 12 }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
          {data.map((entry, index) => (
            <Cell key={`bar-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

