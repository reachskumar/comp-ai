import {
  LayoutDashboard,
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
}

export const mainNavItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
];

export const navGroups: NavGroup[] = [
  {
    title: "Data Hygiene",
    icon: Database,
    items: [
      { title: "Import Files", href: "/dashboard/data-hygiene/import", icon: Upload },
      { title: "Import History", href: "/dashboard/data-hygiene/history", icon: History },
    ],
  },
  {
    title: "Rules Copilot",
    icon: Cpu,
    items: [
      { title: "Rule Sets", href: "/dashboard/rules/rule-sets", icon: BookOpen },
      { title: "Simulator", href: "/dashboard/rules/simulator", icon: FlaskConical },
      { title: "Test Cases", href: "/dashboard/rules/test-cases", icon: TestTubeDiagonal },
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

