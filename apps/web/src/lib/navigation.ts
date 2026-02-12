import {
  LayoutDashboard,
  MessageSquareText,
  Sparkles,
  Database,
  Upload,
  History,
  Cpu,
  BookOpen,
  FlaskConical,
  TestTubeDiagonal,
  RefreshCw,
  ListChecks,
  BarChart3,
  GitCompare,
  Shield,
  Play,
  AlertTriangle,
  FileCheck,
  Settings,
  Building2,
  Users,
  ScrollText,
  Heart,
  HeartPulse,
  Landmark,
  SlidersHorizontal,
  Dumbbell,
  Gift,
  CalendarDays,
  Award,
  PieChart,
  Scale,
  LayoutGrid,
  Plug,
  AppWindow,
  RefreshCcw,
  Map,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
  /** Visual label shown next to the group title */
  badge?: string;
}

export const mainNavItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "AI Copilot", href: "/dashboard/ai-copilot", icon: MessageSquareText },
];

export const navGroups: NavGroup[] = [
  // ── AI-Powered Features ──────────────────────────────────
  {
    title: "AI Features",
    icon: Sparkles,
    badge: "AI",
    items: [
      { title: "Rules Copilot", href: "/dashboard/rules/rule-sets", icon: Cpu },
      { title: "Simulator", href: "/dashboard/rules/simulator", icon: FlaskConical },
      { title: "Test Cases", href: "/dashboard/rules/test-cases", icon: TestTubeDiagonal },
      { title: "Pay Equity", href: "/dashboard/analytics/pay-equity", icon: Scale },
      { title: "HR Dashboards", href: "/dashboard/analytics/hr-dashboards", icon: LayoutGrid },
    ],
  },
  // ── Core Modules ─────────────────────────────────────────
  {
    title: "Data Hygiene",
    icon: Database,
    items: [
      { title: "Import Files", href: "/dashboard/data-hygiene/import", icon: Upload },
      { title: "Import History", href: "/dashboard/data-hygiene/history", icon: History },
    ],
  },
  {
    title: "Comp Cycles",
    icon: RefreshCw,
    items: [
      { title: "Active Cycles", href: "/dashboard/comp-cycles/active", icon: ListChecks },
      { title: "Recommendations", href: "/dashboard/comp-cycles/recommendations", icon: BarChart3 },
      { title: "Calibration", href: "/dashboard/comp-cycles/calibration", icon: GitCompare },
    ],
  },
  {
    title: "Payroll Guard",
    icon: Shield,
    items: [
      { title: "Payroll Runs", href: "/dashboard/payroll/runs", icon: Play },
      { title: "Anomalies", href: "/dashboard/payroll/anomalies", icon: AlertTriangle },
      { title: "Reconciliation", href: "/dashboard/payroll/reconciliation", icon: FileCheck },
    ],
  },
  // ── Benefits (Compport-managed) ──────────────────────────
  {
    title: "Benefits",
    icon: Heart,
    items: [
      { title: "Health & Insurance", href: "/dashboard/benefits/health", icon: HeartPulse },
      { title: "Retirement Plans", href: "/dashboard/benefits/retirement", icon: Landmark },
      { title: "Flexible Benefits", href: "/dashboard/benefits/flex", icon: SlidersHorizontal },
      { title: "Wellness Programs", href: "/dashboard/benefits/wellness", icon: Dumbbell },
      { title: "Perks & Allowances", href: "/dashboard/benefits/perks", icon: Gift },
      { title: "Leave Management", href: "/dashboard/benefits/leave", icon: CalendarDays },
      { title: "Recognition & Rewards", href: "/dashboard/benefits/recognition", icon: Award },
    ],
  },
  // ── Analytics ────────────────────────────────────────────
  {
    title: "Analytics",
    icon: PieChart,
    items: [
      { title: "Total Rewards", href: "/dashboard/analytics/total-rewards", icon: BarChart3 },
    ],
  },
  // ── Integrations ─────────────────────────────────────────
  {
    title: "Integrations",
    icon: Plug,
    items: [
      { title: "Connected Apps", href: "/dashboard/integrations/apps", icon: AppWindow },
      { title: "Sync Status", href: "/dashboard/integrations/sync", icon: RefreshCcw },
      { title: "Field Mapping", href: "/dashboard/integrations/mapping", icon: Map },
    ],
  },
];

export const settingsGroup: NavGroup = {
  title: "Settings",
  icon: Settings,
  items: [
    { title: "Tenant Settings", href: "/dashboard/settings/tenant", icon: Building2 },
    { title: "Users & Roles", href: "/dashboard/settings/users", icon: Users },
    { title: "Audit Log", href: "/dashboard/settings/audit-log", icon: ScrollText },
  ],
};

