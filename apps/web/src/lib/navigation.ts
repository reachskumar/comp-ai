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
  ShieldCheck,
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
  Grid3X3,
  Plug,
  AppWindow,
  RefreshCcw,
  Map,
  FileBarChart,
  FileText,
  Zap,
  Coins,
  Trophy,
  Briefcase,
  UserX,
  Network,
  Layers,
  DatabaseBackup,
  Activity,
  type LucideIcon,
} from 'lucide-react';

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
  /** Feature key for gating — if set, group only shows when this feature is enabled for the tenant */
  featureKey?: string;
}

export const mainNavItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'AI Copilot', href: '/dashboard/ai-copilot', icon: MessageSquareText },
  { title: 'My Rewards', href: '/dashboard/my-rewards', icon: Trophy },
];

export const navGroups: NavGroup[] = [
  // ── AI-Powered Features ──────────────────────────────────
  {
    title: 'AI Features',
    icon: Sparkles,
    badge: 'AI',
    featureKey: 'ai_features',
    items: [
      { title: 'Rules Copilot', href: '/dashboard/rules/rule-sets', icon: Cpu },
      { title: 'Simulator', href: '/dashboard/rules/simulator', icon: FlaskConical },
      { title: 'Test Cases', href: '/dashboard/rules/test-cases', icon: TestTubeDiagonal },
      { title: 'Pay Equity', href: '/dashboard/analytics/pay-equity', icon: Scale },
      { title: 'EDGE Pay Equity', href: '/dashboard/analytics/pay-equity/edge', icon: ShieldCheck },
      { title: 'Pay Equity Workspace', href: '/dashboard/pay-equity', icon: Scale },
      { title: 'HR Dashboards', href: '/dashboard/analytics/hr-dashboards', icon: LayoutGrid },
      { title: 'Report Builder', href: '/dashboard/reports', icon: FileBarChart },
      { title: 'Letters', href: '/dashboard/letters', icon: FileText },
      { title: 'Compliance', href: '/dashboard/compliance', icon: ShieldCheck },
      { title: 'Policy AI', href: '/dashboard/ai-policies', icon: BookOpen },
      { title: 'Retention Risk', href: '/dashboard/attrition', icon: UserX },
      { title: 'AI Calibration', href: '/dashboard/comp-cycles/calibration', icon: GitCompare },
    ],
  },
  // ── Core Modules ─────────────────────────────────────────
  {
    title: 'Data Hygiene',
    icon: Database,
    featureKey: 'data_hygiene',
    items: [
      { title: 'Import Files', href: '/dashboard/data-hygiene/import', icon: Upload },
      { title: 'Import History', href: '/dashboard/data-hygiene/history', icon: History },
      { title: 'Data Explorer', href: '/dashboard/data/explorer', icon: DatabaseBackup },
    ],
  },
  {
    title: 'Comp Cycles',
    icon: RefreshCw,
    featureKey: 'comp_cycles',
    items: [
      { title: 'Active Cycles', href: '/dashboard/comp-cycles/active', icon: ListChecks },
      { title: 'My Team', href: '/dashboard/comp-cycles/my-team', icon: Users },
      { title: 'Recommendations', href: '/dashboard/comp-cycles/recommendations', icon: BarChart3 },
      { title: 'Calibration', href: '/dashboard/comp-cycles/calibration', icon: GitCompare },
      { title: 'Merit Matrix', href: '/dashboard/comp-cycles/merit-matrix', icon: Grid3X3 },
      { title: 'Ad Hoc Changes', href: '/dashboard/adhoc', icon: Zap },
    ],
  },
  {
    title: 'Payroll Guard',
    icon: Shield,
    featureKey: 'payroll_guard',
    items: [
      { title: 'Payroll Runs', href: '/dashboard/payroll/runs', icon: Play },
      { title: 'Anomalies', href: '/dashboard/payroll/anomalies', icon: AlertTriangle },
      { title: 'Reconciliation', href: '/dashboard/payroll/reconciliation', icon: FileCheck },
    ],
  },
  // ── Benefits (Compport-managed) ──────────────────────────
  {
    title: 'Benefits',
    icon: Heart,
    featureKey: 'benefits',
    items: [
      { title: 'Health & Insurance', href: '/dashboard/benefits/health', icon: HeartPulse },
      { title: 'Retirement Plans', href: '/dashboard/benefits/retirement', icon: Landmark },
      { title: 'Flexible Benefits', href: '/dashboard/benefits/flex', icon: SlidersHorizontal },
      { title: 'Wellness Programs', href: '/dashboard/benefits/wellness', icon: Dumbbell },
      { title: 'Perks & Allowances', href: '/dashboard/benefits/perks', icon: Gift },
      { title: 'Leave Management', href: '/dashboard/benefits/leave', icon: CalendarDays },
      { title: 'Recognition & Rewards', href: '/dashboard/benefits/recognition', icon: Award },
    ],
  },
  // ── Organization ───────────────────────────────────────
  {
    title: 'Organization',
    icon: Network,
    featureKey: 'organization',
    items: [{ title: 'Job Architecture', href: '/dashboard/job-architecture', icon: Layers }],
  },
  // ── Equity ─────────────────────────────────────────────
  {
    title: 'Equity Plans',
    icon: Briefcase,
    featureKey: 'equity_plans',
    items: [{ title: 'Overview', href: '/dashboard/equity', icon: PieChart }],
  },
  // ── Analytics ────────────────────────────────────────────
  {
    title: 'Analytics',
    icon: PieChart,
    featureKey: 'analytics',
    items: [
      { title: 'Total Rewards', href: '/dashboard/analytics/total-rewards', icon: BarChart3 },
      { title: 'Simulations', href: '/dashboard/analytics/simulations', icon: Zap },
      { title: 'Benchmarking', href: '/dashboard/benchmarking', icon: Scale },
    ],
  },
  // ── Integrations ─────────────────────────────────────────
  {
    title: 'Integrations',
    icon: Plug,
    featureKey: 'integrations',
    items: [
      { title: 'Connected Apps', href: '/dashboard/integrations/apps', icon: AppWindow },
      { title: 'Sync Status', href: '/dashboard/integrations/sync', icon: RefreshCcw },
      { title: 'Field Mapping', href: '/dashboard/integrations/mapping', icon: Map },
    ],
  },
];

/**
 * Platform Admin nav group — only visible for PLATFORM_ADMIN role.
 * Cross-tenant management of customers, onboarding, and platform stats.
 */
export const platformAdminGroup: NavGroup = {
  title: 'Platform Admin',
  icon: Shield,
  badge: 'Admin',
  items: [
    { title: 'Customers', href: '/dashboard/admin/customers', icon: Building2 },
    { title: 'Onboarding', href: '/dashboard/admin/onboarding', icon: Upload },
    { title: 'Data Explorer', href: '/dashboard/admin/data-explorer', icon: DatabaseBackup },
    { title: 'Sync Status', href: '/dashboard/admin/sync-status', icon: Activity },
    { title: 'Platform Stats', href: '/dashboard/admin/stats', icon: PieChart },
  ],
};

export const settingsGroup: NavGroup = {
  title: 'Settings',
  icon: Settings,
  items: [
    { title: 'Tenant Settings', href: '/dashboard/settings/tenant', icon: Building2 },
    { title: 'Users & Roles', href: '/dashboard/settings/users', icon: Users },
    { title: 'Audit Log', href: '/dashboard/settings/audit-log', icon: ScrollText },
    { title: 'Currency', href: '/dashboard/settings/currency', icon: Coins },
    { title: 'Write-Back', href: '/dashboard/settings/writeback', icon: DatabaseBackup },
  ],
};
