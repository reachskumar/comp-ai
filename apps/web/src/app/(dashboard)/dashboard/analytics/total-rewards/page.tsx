"use client";

import { useState, useEffect } from "react";
import {
  DollarSign,
  Download,
  Users,
  User,
  Award,
  Heart,
  Briefcase,
  Gift,
  PiggyBank,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DonutChart } from "@/components/charts/donut-chart";
import { HorizontalBarChart } from "@/components/charts/horizontal-bar-chart";
import { SparklineChart } from "@/components/charts/sparkline-chart";
import type { DonutChartDataItem } from "@/components/charts/donut-chart";
import type { MarketComparisonItem } from "@/components/charts/horizontal-bar-chart";

// ─── Constants ───────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "#2FA84F", "#3B82F6", "#8B5CF6", "#F59E0B", "#06B6D4", "#EC4899",
];

const CATEGORY_ICONS = [DollarSign, Award, Briefcase, Heart, PiggyBank, Gift];

const EVENT_TYPE_COLORS: Record<string, string> = {
  raise: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  bonus: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  equity: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  promotion: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface BreakdownItem {
  category: string;
  value: number;
  previousValue: number;
}

interface TimelineEvent {
  date: string;
  event: string;
  amount: number;
  type: string;
}

// ─── Mock Data ───────────────────────────────────────────────────────────────

const mockBreakdown: BreakdownItem[] = [
  { category: "Base Salary", value: 125000, previousValue: 118000 },
  { category: "Annual Bonus", value: 25000, previousValue: 22000 },
  { category: "Equity/LTI", value: 18000, previousValue: 15000 },
  { category: "Health Benefits", value: 12500, previousValue: 11500 },
  { category: "Retirement", value: 5000, previousValue: 4500 },
  { category: "Perks & Allowances", value: 2000, previousValue: 1000 },
];

const mockTimeline: TimelineEvent[] = [
  { date: "2026-01-15", event: "Annual Merit Increase", amount: 7000, type: "raise" },
  { date: "2025-12-01", event: "Year-End Bonus", amount: 25000, type: "bonus" },
  { date: "2025-07-01", event: "Equity Vest", amount: 6000, type: "equity" },
  { date: "2025-03-15", event: "Promotion to Senior", amount: 12000, type: "promotion" },
  { date: "2025-01-15", event: "Annual Merit Increase", amount: 5500, type: "raise" },
];

const mockMarketData: MarketComparisonItem[] = [
  { label: "25th", value: 145000, percentile: 25, color: "#E5E7EB" },
  { label: "50th", value: 170000, percentile: 50, color: "#93C5FD" },
  { label: "75th", value: 195000, percentile: 75, color: "#3B82F6" },
  { label: "90th", value: 225000, percentile: 90, color: "#1D4ED8" },
];

const mockTeamBreakdown = [
  { category: "Base Salary", avgValue: 110000 },
  { category: "Annual Bonus", avgValue: 22000 },
  { category: "Equity/LTI", avgValue: 15000 },
  { category: "Health Benefits", avgValue: 12000 },
  { category: "Retirement", avgValue: 4500 },
  { category: "Perks & Allowances", avgValue: 1500 },
];

const mockHeadcount = [
  { level: "Junior", count: 3, avgComp: 95000 },
  { level: "Mid", count: 5, avgComp: 145000 },
  { level: "Senior", count: 3, avgComp: 190000 },
  { level: "Lead", count: 1, avgComp: 230000 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateSparkline(current: number, previous: number) {
  const points = [];
  const diff = current - previous;
  for (let i = 0; i < 12; i++) {
    const progress = i / 11;
    const noise = Math.sin(i * 1.5) * diff * 0.1;
    points.push({ value: Math.round(previous + diff * progress + noise) });
  }
  return points;
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString()}`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Animated Counter ────────────────────────────────────────────────────────

function AnimatedCounter({ target, duration = 1800 }: { target: number; duration?: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let start = 0;
    const increment = target / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return <span>${count.toLocaleString()}</span>;
}

// ─── Personal View ───────────────────────────────────────────────────────────

function PersonalRewardsView() {
  const totalRewards = mockBreakdown.reduce((sum, item) => sum + item.value, 0);
  const previousTotal = mockBreakdown.reduce((sum, item) => sum + item.previousValue, 0);
  const yoyChange = ((totalRewards - previousTotal) / previousTotal) * 100;

  const donutData: DonutChartDataItem[] = mockBreakdown.map((item, i) => ({
    name: item.category,
    value: item.value,
    color: CHART_COLORS[i] || "#6B7280",
  }));

  return (
    <div className="space-y-6">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/5 via-primary/10 to-accent border p-6 lg:p-8">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-primary/5 to-transparent" aria-hidden="true" />
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/20">
              <User className="h-8 w-8 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Sarah Johnson</h2>
              <p className="text-sm text-muted-foreground">Senior Software Engineer · Engineering</p>
            </div>
          </div>
          <div className="text-left md:text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Total Rewards Value
            </p>
            <p className="text-3xl lg:text-4xl font-bold tracking-tight text-primary">
              <AnimatedCounter target={totalRewards} />
            </p>
            <div className="mt-1 flex items-center gap-1 md:justify-end">
              {yoyChange >= 0 ? (
                <ArrowUpRight className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-4 w-4 text-red-600" aria-hidden="true" />
              )}
              <span className={`text-sm font-medium ${yoyChange >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {yoyChange >= 0 ? "+" : ""}{yoyChange.toFixed(1)}% vs last year
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Donut Chart + Breakdown Legend */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compensation Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              data={donutData}
              centerLabel="Total"
              centerValue={formatCurrency(totalRewards)}
            />
            <div className="mt-4 space-y-2">
              {mockBreakdown.map((item, i) => (
                <div key={item.category} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: CHART_COLORS[i] }}
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{item.category}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(item.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Market Comparison */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Compensation vs. Market</CardTitle>
              <Badge variant="secondary" className="text-xs">75th Percentile</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <HorizontalBarChart data={mockMarketData} employeePercentile={75} />
            <p className="mt-3 text-xs text-muted-foreground text-center">
              Your total compensation of {formatCurrency(totalRewards)} places you near the 75th percentile of the market.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Component Cards Grid */}
      <div>
        <h3 className="text-base font-semibold mb-3">Compensation Components</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mockBreakdown.map((item, i) => {
            const Icon = CATEGORY_ICONS[i] || DollarSign;
            const change = ((item.value - item.previousValue) / item.previousValue) * 100;
            const isUp = change >= 0;
            const sparkData = generateSparkline(item.value, item.previousValue);

            return (
              <Card key={item.category} className="group hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${CHART_COLORS[i]}15` }}
                      >
                        <Icon className="h-4 w-4" style={{ color: CHART_COLORS[i] }} aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{item.category}</p>
                        <p className="text-lg font-bold">{formatCurrency(item.value)}</p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-0.5 text-xs font-medium ${isUp ? "text-emerald-600" : "text-red-600"}`}>
                      {isUp ? (
                        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
                      )}
                      {isUp ? "+" : ""}{change.toFixed(1)}%
                    </div>
                  </div>
                  <div className="mt-3">
                    <SparklineChart data={sparkData} color={CHART_COLORS[i]} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>


      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compensation History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mockTimeline.map((evt, i) => (
              <div key={i} className="flex items-start gap-4">
                <div className="flex flex-col items-center">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${EVENT_TYPE_COLORS[evt.type] || "bg-muted text-muted-foreground"}`}>
                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                  {i < mockTimeline.length - 1 && (
                    <div className="mt-1 h-8 w-px bg-border" aria-hidden="true" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{evt.event}</p>
                    <span className="text-sm font-semibold text-emerald-600">
                      +{formatCurrency(evt.amount)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDate(evt.date)}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Team Overview View ──────────────────────────────────────────────────────

function TeamOverviewView() {
  const teamTotal = mockTeamBreakdown.reduce((sum, item) => sum + item.avgValue, 0);

  const donutData: DonutChartDataItem[] = mockTeamBreakdown.map((item, i) => ({
    name: item.category,
    value: item.avgValue,
    color: CHART_COLORS[i] || "#6B7280",
  }));

  return (
    <div className="space-y-6">
      {/* Team Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="text-2xl font-bold">12</p>
                <p className="text-xs text-muted-foreground">Team Members</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <DollarSign className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(165000)}</p>
                <p className="text-xs text-muted-foreground">Avg Total Rewards</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <TrendingUp className="h-5 w-5 text-blue-600" aria-hidden="true" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(158000)}</p>
                <p className="text-xs text-muted-foreground">Median Total Rewards</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Breakdown + Headcount */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team Avg. Compensation Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              data={donutData}
              centerLabel="Avg Total"
              centerValue={formatCurrency(teamTotal)}
            />
            <div className="mt-4 space-y-2">
              {mockTeamBreakdown.map((item, i) => (
                <div key={item.category} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: CHART_COLORS[i] }}
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{item.category}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(item.avgValue)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headcount by Level</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockHeadcount.map((level) => {
                const maxComp = 230000;
                const widthPct = (level.avgComp / maxComp) * 100;
                return (
                  <div key={level.level}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium">{level.level}</span>
                      <span className="text-muted-foreground">
                        {level.count} people · {formatCurrency(level.avgComp)} avg
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function TotalRewardsPage() {
  const [view, setView] = useState<"personal" | "team">("personal");

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Total Rewards Statement</h1>
          <p className="text-muted-foreground">
            Your complete compensation and benefits overview for {new Date().getFullYear()}.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Tabs value={view} onValueChange={(v) => setView(v as "personal" | "team")}>
            <TabsList>
              <TabsTrigger value="personal">
                <User className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                My Rewards
              </TabsTrigger>
              <TabsTrigger value="team">
                <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Team Overview
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* View Content */}
      {view === "personal" ? <PersonalRewardsView /> : <TeamOverviewView />}
    </div>
  );
}