"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Database,
  Cpu,
  RefreshCw,
  Shield,
  Upload,
  FlaskConical,
  BarChart3,
  AlertTriangle,
  Users,
  TrendingUp,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Heart,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/stores/auth-store";

function AnimatedCounter({ target, duration = 1500 }: { target: number; duration?: number }) {
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
  return <span>{count.toLocaleString()}</span>;
}

const stats = [
  { title: "Total Employees", value: 2847, icon: Users, change: "+12%", up: true },
  { title: "Active Cycles", value: 4, icon: RefreshCw, change: "+2", up: true },
  { title: "Avg. Compensation", value: 87500, icon: DollarSign, change: "+5.2%", up: true, prefix: "$" },
  { title: "Benefits Enrolled", value: 2134, icon: Heart, change: "+8%", up: true },
];

const modules = [
  {
    title: "Data Hygiene",
    description: "Data import and validation pipeline",
    icon: Database,
    stats: "12 imports processed",
    detail: "Last import: 2 hours ago",
    badge: "Healthy",
    badgeVariant: "default" as const,
    href: "/dashboard/data-hygiene/import",
    secondaryIcon: Upload,
    color: "from-emerald-500/10 to-teal-500/10",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  {
    title: "Rules Copilot",
    description: "Compensation rule management",
    icon: Cpu,
    stats: "8 active rule sets",
    detail: "3 simulations this week",
    badge: "Active",
    badgeVariant: "default" as const,
    href: "/dashboard/rules/rule-sets",
    secondaryIcon: FlaskConical,
    color: "from-blue-500/10 to-indigo-500/10",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  {
    title: "Comp Cycles",
    description: "Compensation cycle management",
    icon: RefreshCw,
    stats: "2 active cycles",
    detail: "Budget utilization: 73%",
    badge: "In Progress",
    badgeVariant: "secondary" as const,
    href: "/dashboard/comp-cycles/active",
    secondaryIcon: BarChart3,
    color: "from-violet-500/10 to-purple-500/10",
    iconColor: "text-violet-600 dark:text-violet-400",
  },
  {
    title: "Payroll Guard",
    description: "Payroll validation and anomaly detection",
    icon: Shield,
    stats: "3 anomalies detected",
    detail: "Last payroll run: yesterday",
    badge: "Needs Review",
    badgeVariant: "outline" as const,
    href: "/dashboard/payroll/runs",
    secondaryIcon: AlertTriangle,
    color: "from-amber-500/10 to-orange-500/10",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
];

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(" ")[0] || "there";

  return (
    <div className="space-y-8">
      {/* Welcome hero */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/5 via-primary/10 to-accent border p-6 lg:p-8">
        <div className="relative z-10">
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
            Welcome back, {firstName} 👋
          </h1>
          <p className="text-muted-foreground mt-1 max-w-lg">
            Here&apos;s an overview of your compensation and benefits platform. Everything looks good today.
          </p>
        </div>
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-primary/5 to-transparent" aria-hidden="true" />
      </div>

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="border bg-card/50 backdrop-blur-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <stat.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <div className={`flex items-center gap-0.5 text-xs font-medium ${stat.up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {stat.up ? <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> : <ArrowDownRight className="h-3 w-3" aria-hidden="true" />}
                  {stat.change}
                </div>
              </div>
              <div className="mt-3">
                <p className="text-2xl font-bold tracking-tight">
                  {stat.prefix}<AnimatedCounter target={stat.value} />
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.title}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Module cards */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Modules</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((mod) => (
            <Link key={mod.title} href={mod.href}>
              <Card className="transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border bg-card/50 backdrop-blur-sm cursor-pointer group">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${mod.color}`}>
                      <mod.icon className={`h-5 w-5 ${mod.iconColor}`} aria-hidden="true" />
                    </div>
                    <div>
                      <CardTitle className="text-base group-hover:text-primary transition-colors">{mod.title}</CardTitle>
                      <CardDescription className="text-xs">{mod.description}</CardDescription>
                    </div>
                  </div>
                  <Badge variant={mod.badgeVariant}>{mod.badge}</Badge>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-semibold">{mod.stats}</p>
                      <p className="text-xs text-muted-foreground">{mod.detail}</p>
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 group-hover:bg-primary/10 transition-colors">
                      <TrendingUp className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden="true" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

