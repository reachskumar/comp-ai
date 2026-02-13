"use client";

import { cn } from "@/lib/utils";

interface ComplianceScoreGaugeProps {
  score: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-500";
  if (score >= 60) return "text-yellow-500";
  if (score >= 40) return "text-orange-500";
  return "text-red-500";
}

function getScoreLabel(score: number): string {
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Needs Attention";
  return "Critical";
}

function getStrokeColor(score: number): string {
  if (score >= 80) return "stroke-green-500";
  if (score >= 60) return "stroke-yellow-500";
  if (score >= 40) return "stroke-orange-500";
  return "stroke-red-500";
}

const sizes = {
  sm: { width: 120, strokeWidth: 8, fontSize: "text-2xl", labelSize: "text-xs" },
  md: { width: 180, strokeWidth: 10, fontSize: "text-4xl", labelSize: "text-sm" },
  lg: { width: 240, strokeWidth: 12, fontSize: "text-5xl", labelSize: "text-base" },
};

export function ComplianceScoreGauge({
  score,
  size = "md",
  className,
}: ComplianceScoreGaugeProps) {
  const { width, strokeWidth, fontSize, labelSize } = sizes[size];
  const radius = (width - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const displayScore = score ?? 0;
  const progress = (displayScore / 100) * circumference;

  if (score === null) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2", className)}>
        <div
          className="flex items-center justify-center rounded-full border-4 border-dashed border-muted"
          style={{ width, height: width }}
        >
          <span className="text-sm text-muted-foreground">No scan yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center justify-center gap-1", className)}>
      <div className="relative" style={{ width, height: width }}>
        <svg width={width} height={width} className="-rotate-90">
          <circle
            cx={width / 2}
            cy={width / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/30"
          />
          <circle
            cx={width / 2}
            cy={width / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            strokeLinecap="round"
            className={cn("transition-all duration-1000", getStrokeColor(displayScore))}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-bold", fontSize, getScoreColor(displayScore))}>
            {displayScore}
          </span>
          <span className={cn("text-muted-foreground", labelSize)}>/ 100</span>
        </div>
      </div>
      <span className={cn("font-medium", labelSize, getScoreColor(displayScore))}>
        {getScoreLabel(displayScore)}
      </span>
    </div>
  );
}

