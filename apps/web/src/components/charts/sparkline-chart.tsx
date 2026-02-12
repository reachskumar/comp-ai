"use client";

import { LineChart, Line, ResponsiveContainer } from "recharts";

export interface SparklineDataPoint {
  value: number;
}

interface SparklineChartProps {
  data: SparklineDataPoint[];
  color?: string;
  height?: number;
}

export function SparklineChart({ data, color = "#2FA84F", height = 32 }: SparklineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

