"use client";

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
  MessageSquareText,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";

const modules = [
  {
    title: "AI Copilot",
    description: "Ask questions about compensation, get AI-powered insights",
    icon: MessageSquareText,
    href: "/dashboard/ai-copilot",
    cta: "Start a conversation",
    color: "from-primary/10 to-primary/5",
    iconColor: "text-primary",
  },
  {
    title: "Data Hygiene",
    description: "Import and validate employee compensation data",
    icon: Database,
    href: "/dashboard/data-hygiene/import",
    cta: "Import data",
    color: "from-emerald-500/10 to-teal-500/10",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  {
    title: "Rules Copilot",
    description: "AI-powered compensation rule management and simulation",
    icon: Cpu,
    href: "/dashboard/rules/rule-sets",
    cta: "Manage rules",
    color: "from-blue-500/10 to-indigo-500/10",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  {
    title: "Comp Cycles",
    description: "Create and manage compensation review cycles",
    icon: RefreshCw,
    href: "/dashboard/comp-cycles/active",
    cta: "View cycles",
    color: "from-violet-500/10 to-purple-500/10",
    iconColor: "text-violet-600 dark:text-violet-400",
  },
  {
    title: "Payroll Guard",
    description: "Validate payroll runs and detect anomalies",
    icon: Shield,
    href: "/dashboard/payroll/runs",
    cta: "Check payroll",
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
            Your AI-powered compensation intelligence platform. Get started by importing data or asking the AI Copilot a question.
          </p>
          <div className="mt-4 flex gap-3">
            <Link href="/dashboard/ai-copilot">
              <Button>
                <MessageSquareText className="mr-2 h-4 w-4" aria-hidden="true" />
                Ask AI Copilot
              </Button>
            </Link>
            <Link href="/dashboard/data-hygiene/import">
              <Button variant="outline">
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                Import Data
              </Button>
            </Link>
          </div>
        </div>
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-primary/5 to-transparent" aria-hidden="true" />
      </div>

      {/* Quick start modules */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Get Started</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod) => (
            <Link key={mod.title} href={mod.href}>
              <Card className="transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border bg-card/50 backdrop-blur-sm cursor-pointer group h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${mod.color}`}>
                      <mod.icon className={`h-5 w-5 ${mod.iconColor}`} aria-hidden="true" />
                    </div>
                    <div>
                      <CardTitle className="text-base group-hover:text-primary transition-colors">{mod.title}</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{mod.description}</p>
                  <p className="mt-3 text-sm font-medium text-primary flex items-center gap-1 group-hover:gap-2 transition-all">
                    {mod.cta}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

