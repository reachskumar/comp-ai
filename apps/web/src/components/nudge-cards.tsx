'use client';

import {
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Users,
  Sparkles,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  Loader2,
  ShieldAlert,
  BarChart3,
} from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNudges, type Nudge } from '@/hooks/use-nudges';
import { useCopilotPanel } from '@/app/(dashboard)/layout';

const NUDGE_ICONS: Record<Nudge['type'], React.ReactNode> = {
  pay_below_range: <TrendingDown className="h-4 w-4" />,
  pay_above_range: <TrendingUp className="h-4 w-4" />,
  performance_mismatch: <AlertTriangle className="h-4 w-4" />,
  gender_gap_risk: <ShieldAlert className="h-4 w-4" />,
  compa_ratio_outlier: <BarChart3 className="h-4 w-4" />,
};

const SEVERITY_STYLES: Record<Nudge['severity'], { border: string; badge: string; icon: string }> =
  {
    critical: {
      border: 'border-red-200 dark:border-red-900/50',
      badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      icon: 'text-red-500',
    },
    warning: {
      border: 'border-amber-200 dark:border-amber-900/50',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      icon: 'text-amber-500',
    },
    info: {
      border: 'border-blue-200 dark:border-blue-900/50',
      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      icon: 'text-blue-500',
    },
  };

export function NudgeCards() {
  const { data: nudges, isLoading } = useNudges();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        Analyzing compensation data for insights…
      </div>
    );
  }

  if (!nudges || nudges.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary" />
        AI Insights
        <Badge variant="secondary" className="text-xs">
          {nudges.length}
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {nudges.map((nudge) => (
          <NudgeCard key={nudge.id} nudge={nudge} />
        ))}
      </div>
    </div>
  );
}

function NudgeCard({ nudge }: { nudge: Nudge }) {
  const [expanded, setExpanded] = useState(false);
  const { openPanel } = useCopilotPanel();
  const styles = SEVERITY_STYLES[nudge.severity];

  return (
    <Card className={`${styles.border} transition-all hover:shadow-sm`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={styles.icon}>{NUDGE_ICONS[nudge.type]}</div>
            <CardTitle className="text-sm font-semibold leading-tight">{nudge.title}</CardTitle>
          </div>
          <Badge className={`${styles.badge} text-[10px] px-1.5 py-0 h-5 shrink-0`}>
            {nudge.severity}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed">{nudge.description}</p>
        <p className="text-xs text-foreground/80">{nudge.suggestedAction}</p>

        {nudge.employees.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Users className="h-3 w-3" />
            {nudge.employeeCount} employee{nudge.employeeCount > 1 ? 's' : ''}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}

        {expanded && nudge.employees.length > 0 && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-1 max-h-40 overflow-auto">
            {nudge.employees.map((emp) => (
              <div key={emp.id} className="flex items-center justify-between text-[11px]">
                <span className="font-medium">{emp.name}</span>
                <span className="text-muted-foreground">
                  {emp.department} · CR: {emp.compaRatio?.toFixed(2) ?? '—'}
                  {emp.performanceRating ? ` · Perf: ${emp.performanceRating}` : ''}
                </span>
              </div>
            ))}
            {nudge.employeeCount > nudge.employees.length && (
              <p className="text-[10px] text-muted-foreground text-center pt-1">
                + {nudge.employeeCount - nudge.employees.length} more
              </p>
            )}
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs h-7 gap-1.5"
          onClick={() => openPanel(nudge.copilotPrompt)}
        >
          <MessageSquareText className="h-3 w-3" />
          Ask Copilot
        </Button>
      </CardContent>
    </Card>
  );
}
