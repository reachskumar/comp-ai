'use client';

import * as React from 'react';
import {
  DollarSign,
  FileDown,
  FileText,
  Heart,
  Briefcase,
  Target,
  Award,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  useEmployeeProfile,
  useCompHistory,
  usePortalEquity,
  usePortalBenefits,
  useCareerPath,
  usePortalDocuments,
  type EmployeeProfile,
  type CompHistoryEntry,
  type EquityPortalData,
  type BenefitEnrollmentPortal,
  type CareerPathData,
  type PortalDocuments,
} from '@/hooks/use-employee-portal';
import { getStatementDownloadUrl } from '@/hooks/use-rewards-statements';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRC = React.ComponentType<any>;
interface RC {
  AreaChart: AnyRC;
  Area: AnyRC;
  BarChart: AnyRC;
  Bar: AnyRC;
  XAxis: AnyRC;
  YAxis: AnyRC;
  CartesianGrid: AnyRC;
  Tooltip: AnyRC;
  ResponsiveContainer: AnyRC;
  ReferenceLine: AnyRC;
  Cell: AnyRC;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function MyRewardsPage() {
  const [tab, setTab] = React.useState('overview');
  const [rc, setRc] = React.useState<RC | null>(null);
  const profileQ = useEmployeeProfile();
  const compHistQ = useCompHistory();
  const equityQ = usePortalEquity();
  const benefitsQ = usePortalBenefits();
  const careerQ = useCareerPath();
  const docsQ = usePortalDocuments();

  React.useEffect(() => {
    import('recharts').then((m) =>
      setRc({
        AreaChart: m.AreaChart,
        Area: m.Area,
        BarChart: m.BarChart,
        Bar: m.Bar,
        XAxis: m.XAxis,
        YAxis: m.YAxis,
        CartesianGrid: m.CartesianGrid,
        Tooltip: m.Tooltip,
        ResponsiveContainer: m.ResponsiveContainer,
        ReferenceLine: m.ReferenceLine,
        Cell: m.Cell,
      }),
    );
  }, []);

  const p = profileQ.data;
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Rewards</h1>
        <p className="text-muted-foreground">
          {p
            ? `${p.employee.firstName} ${p.employee.lastName} · ${p.employee.department} · ${p.employee.level}`
            : 'Your personal compensation and benefits portal.'}
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="compensation">Compensation</TabsTrigger>
          <TabsTrigger value="band">Band Position</TabsTrigger>
          <TabsTrigger value="equity">My Equity</TabsTrigger>
          <TabsTrigger value="benefits">My Benefits</TabsTrigger>
          <TabsTrigger value="career">Career Path</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab profile={p} loading={profileQ.isLoading} />
        </TabsContent>
        <TabsContent value="compensation">
          <CompensationTab history={compHistQ.data} loading={compHistQ.isLoading} rc={rc} />
        </TabsContent>
        <TabsContent value="band">
          <BandPositionTab profile={p} loading={profileQ.isLoading} />
        </TabsContent>
        <TabsContent value="equity">
          <EquityTab data={equityQ.data} loading={equityQ.isLoading} rc={rc} />
        </TabsContent>
        <TabsContent value="benefits">
          <BenefitsTab data={benefitsQ.data} loading={benefitsQ.isLoading} />
        </TabsContent>
        <TabsContent value="career">
          <CareerTab data={careerQ.data} loading={careerQ.isLoading} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab data={docsQ.data} loading={docsQ.isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── OVERVIEW TAB ─── */
function OverviewTab({ profile: p, loading }: { profile?: EmployeeProfile; loading: boolean }) {
  if (loading)
    return (
      <div className="space-y-4 mt-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  if (!p)
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No employee record linked to your account.
          </p>
        </CardContent>
      </Card>
    );
  const items = [
    {
      label: 'Base Salary',
      value: p.compensation.baseSalary,
      icon: DollarSign,
      color: 'text-green-600',
    },
    { label: 'Bonus / Variable', value: p.compensation.bonus, icon: Award, color: 'text-blue-600' },
    {
      label: 'Benefits Value',
      value: p.compensation.benefitsValue,
      icon: Heart,
      color: 'text-pink-600',
    },
    {
      label: 'Equity Value',
      value: p.compensation.equityValue,
      icon: Briefcase,
      color: 'text-purple-600',
    },
  ];
  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Compensation</CardDescription>
          <CardTitle className="text-3xl flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-green-600" />
            {fmt(p.compensation.totalComp)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {p.employee.compaRatio != null && (
              <span>
                Compa-Ratio: <strong>{(p.employee.compaRatio * 100).toFixed(0)}%</strong>
              </span>
            )}
            {p.employee.performanceRating != null && (
              <span>
                Performance: <strong>{p.employee.performanceRating}/5</strong>
              </span>
            )}
            <span>
              Hired: <strong>{fmtDate(p.employee.hireDate)}</strong>
            </span>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <Card key={item.label}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <item.icon className={`h-4 w-4 ${item.color}`} />
                {item.label}
              </CardDescription>
              <CardTitle className="text-xl">{fmt(item.value)}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      {p.bandPosition && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" /> Band Position
            </CardTitle>
            <CardDescription>
              {p.bandPosition.jobFamily} · {p.bandPosition.level}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BandGauge band={p.bandPosition} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── BAND GAUGE ─── */
function BandGauge({ band }: { band: NonNullable<EmployeeProfile['bandPosition']> }) {
  const min = band.p10;
  const max = band.p90;
  const range = max - min;
  const pos =
    range > 0 ? Math.max(0, Math.min(100, ((band.currentSalary - min) / range) * 100)) : 50;
  const markers = [
    { label: 'P25', value: band.p25, pct: range > 0 ? ((band.p25 - min) / range) * 100 : 25 },
    { label: 'P50', value: band.p50, pct: range > 0 ? ((band.p50 - min) / range) * 100 : 50 },
    { label: 'P75', value: band.p75, pct: range > 0 ? ((band.p75 - min) / range) * 100 : 75 },
  ];
  return (
    <div className="space-y-3">
      <div className="relative h-8 bg-gradient-to-r from-red-100 via-green-100 to-blue-100 rounded-full overflow-visible">
        {markers.map((m) => (
          <div key={m.label} className="absolute top-0 h-full" style={{ left: `${m.pct}%` }}>
            <div className="w-px h-full bg-gray-400" />
          </div>
        ))}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary border-2 border-white shadow-lg z-10"
          style={{ left: `calc(${pos}% - 8px)` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{fmt(band.p10)}</span>
        {markers.map((m) => (
          <span key={m.label} className="text-center">
            {m.label}
            <br />
            {fmt(m.value)}
          </span>
        ))}
        <span>{fmt(band.p90)}</span>
      </div>
      <p className="text-sm text-center">
        Your salary: <strong>{fmt(band.currentSalary)}</strong>
        {band.currentSalary < band.p50 ? (
          <span className="text-amber-600 ml-2">Below midpoint</span>
        ) : (
          <span className="text-green-600 ml-2">At or above midpoint</span>
        )}
      </p>
    </div>
  );
}

/* ─── PLACEHOLDER TABS (will be replaced) ─── */
function CompensationTab({
  history,
  loading,
  rc,
}: {
  history?: CompHistoryEntry[];
  loading: boolean;
  rc: RC | null;
}) {
  if (loading)
    return (
      <div className="mt-4">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!history || history.length === 0)
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No compensation history available yet.</p>
        </CardContent>
      </Card>
    );

  const chartData = history.map((h) => ({ date: fmtDate(h.date), salary: h.newValue }));

  return (
    <div className="space-y-4 mt-4">
      {/* Salary Timeline Chart */}
      {rc && chartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salary Over Time</CardTitle>
            <CardDescription>
              Your compensation changes across cycles and ad hoc adjustments
            </CardDescription>
          </CardHeader>
          <CardContent>
            <rc.ResponsiveContainer width="100%" height={300}>
              <rc.AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salaryGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <rc.CartesianGrid strokeDasharray="3 3" />
                <rc.XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <rc.YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <rc.Tooltip formatter={(v: number) => [fmt(v), 'Salary']} />
                <rc.Area
                  type="monotone"
                  dataKey="salary"
                  stroke="#6366f1"
                  fill="url(#salaryGrad)"
                  strokeWidth={2}
                />
              </rc.AreaChart>
            </rc.ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* History Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Previous</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{fmtDate(h.date)}</TableCell>
                  <TableCell>
                    <Badge variant={h.type === 'cycle' ? 'default' : 'secondary'}>
                      {h.type === 'cycle' ? 'Cycle' : 'Ad Hoc'}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{h.label}</TableCell>
                  <TableCell className="text-right">{fmt(h.previousValue)}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(h.newValue)}</TableCell>
                  <TableCell className="text-right">
                    <span className={h.changePercent >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {h.changePercent >= 0 ? (
                        <ArrowUpRight className="inline h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="inline h-3 w-3" />
                      )}
                      {Math.abs(h.changePercent).toFixed(1)}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
function BandPositionTab({ profile: p, loading }: { profile?: EmployeeProfile; loading: boolean }) {
  if (loading)
    return (
      <div className="mt-4">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!p?.bandPosition)
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No salary band assigned to your profile.</p>
        </CardContent>
      </Card>
    );
  const b = p.bandPosition;
  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" /> Your Band Position
          </CardTitle>
          <CardDescription>
            {b.jobFamily} · {b.level}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BandGauge band={b} />
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: 'P10', value: b.p10 },
          { label: 'P25', value: b.p25 },
          { label: 'P50 (Mid)', value: b.p50 },
          { label: 'P75', value: b.p75 },
          { label: 'P90', value: b.p90 },
        ].map((item) => (
          <Card key={item.label}>
            <CardHeader className="pb-1">
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="text-lg">{fmt(item.value)}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Position Analysis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Your salary of <strong>{fmt(b.currentSalary)}</strong> places you at{' '}
            <strong>{((b.currentSalary / b.p50) * 100).toFixed(0)}%</strong> of the band midpoint.
          </p>
          {b.currentSalary < b.p25 && (
            <p className="text-amber-600">
              ⚠️ Your salary is below the 25th percentile. Consider discussing with your manager.
            </p>
          )}
          {b.currentSalary >= b.p25 && b.currentSalary < b.p50 && (
            <p className="text-blue-600">
              Your salary is between P25 and P50 — room for growth within band.
            </p>
          )}
          {b.currentSalary >= b.p50 && b.currentSalary < b.p75 && (
            <p className="text-green-600">
              ✅ Your salary is at or above the midpoint — well-positioned in your band.
            </p>
          )}
          {b.currentSalary >= b.p75 && (
            <p className="text-purple-600">🌟 Your salary is in the top quartile of your band.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function EquityTab({
  data,
  loading,
  rc,
}: {
  data?: EquityPortalData;
  loading: boolean;
  rc: RC | null;
}) {
  if (loading)
    return (
      <div className="mt-4">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!data || data.grants.length === 0)
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <Briefcase className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">No equity grants found.</p>
        </CardContent>
      </Card>
    );
  const s = data.summary;
  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Total Grants</CardDescription>
            <CardTitle className="text-xl">{s.totalGrants}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Vested Shares</CardDescription>
            <CardTitle className="text-xl">{s.totalVested.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Unvested Shares</CardDescription>
            <CardTitle className="text-xl">{s.totalUnvested.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Total Value</CardDescription>
            <CardTitle className="text-xl text-green-600">{fmt(s.totalValue)}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Equity Grants</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Grant Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Vested</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.grants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.planName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{g.grantType}</Badge>
                  </TableCell>
                  <TableCell>{fmtDate(g.grantDate)}</TableCell>
                  <TableCell className="text-right">{g.totalShares.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{g.vestedShares.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(g.currentValue)}</TableCell>
                  <TableCell>
                    <Badge variant={g.status === 'FULLY_VESTED' ? 'default' : 'secondary'}>
                      {g.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
function BenefitsTab({ data, loading }: { data?: BenefitEnrollmentPortal[]; loading: boolean }) {
  if (loading)
    return (
      <div className="mt-4">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!data || data.length === 0)
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <Heart className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">No active benefit enrollments.</p>
        </CardContent>
      </Card>
    );
  const totalEmployeeCost = data.reduce((s, e) => s + e.employeePremium * 12, 0);
  const totalEmployerCost = data.reduce((s, e) => s + e.employerPremium * 12, 0);
  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Active Plans</CardDescription>
            <CardTitle className="text-xl">{data.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Your Annual Cost</CardDescription>
            <CardTitle className="text-xl">{fmt(totalEmployeeCost)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Employer Contribution</CardDescription>
            <CardTitle className="text-xl text-green-600">{fmt(totalEmployerCost)}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.map((e) => (
          <Card key={e.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{e.planName}</CardTitle>
                <Badge variant="outline">{e.planType}</Badge>
              </div>
              <CardDescription>
                {e.carrier} · {e.tier.replace(/_/g, ' ')}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Your Premium (monthly)</span>
                <span>{fmt(e.employeePremium)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Employer Premium (monthly)</span>
                <span className="text-green-600">{fmt(e.employerPremium)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Effective</span>
                <span>{fmtDate(e.effectiveDate)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
function CareerTab({ data, loading }: { data?: CareerPathData | null; loading: boolean }) {
  if (loading)
    return (
      <div className="mt-4">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!data)
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Career path information not available.</p>
        </CardContent>
      </Card>
    );
  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Current Level</CardDescription>
            <CardTitle className="text-xl">{data.currentLevel}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Job Family</CardDescription>
            <CardTitle className="text-xl">{data.jobFamily || 'Not assigned'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Next Level</CardDescription>
            <CardTitle className="text-xl">{data.nextLevel ? data.nextLevel.level : '—'}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      {data.nextLevel && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next Level Target</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>
              The next level in your career ladder is <strong>{data.nextLevel.level}</strong> with a
              midpoint salary of <strong>{fmt(data.nextLevel.p50Midpoint)}</strong>.
            </p>
            {data.performanceRating != null && (
              <p>
                Your current performance rating is <strong>{data.performanceRating}/5</strong>.{' '}
                {data.performanceRating >= 4
                  ? '🌟 You are well-positioned for advancement.'
                  : 'Continue building your skills and impact.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {data.careerLadder.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Career Ladder — {data.jobFamily}</CardTitle>
            <CardDescription>Levels in your job family with midpoint salaries</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.careerLadder.map((step, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded-lg border p-3 ${step.isCurrent ? 'border-primary bg-primary/5' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    {step.isCurrent && <Badge>Current</Badge>}
                    <span className="font-medium">{step.level}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{fmt(step.p50)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {data.careerLadder.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Career ladder data coming soon. Your HR team is building out the job architecture.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function DocumentsTab({ data, loading }: { data?: PortalDocuments; loading: boolean }) {
  if (loading)
    return (
      <div className="mt-4">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  const letters = data?.letters ?? [];
  const statements = data?.statements ?? [];
  const empty = letters.length === 0 && statements.length === 0;
  if (empty)
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">No documents available yet.</p>
        </CardContent>
      </Card>
    );

  const API_BASE = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';

  return (
    <div className="space-y-4 mt-4">
      {statements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Total Rewards Statements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {statements.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Total Rewards Statement — {s.year}</p>
                    <p className="text-xs text-muted-foreground">Generated {fmtDate(s.date)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{s.status}</Badge>
                    {s.pdfUrl && (
                      <a
                        href={getStatementDownloadUrl(s.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
                      >
                        <FileDown className="mr-1 h-4 w-4" />
                        Download
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {letters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Compensation Letters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {letters.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{l.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.letterType.replace(/_/g, ' ')} · {fmtDate(l.date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{l.status}</Badge>
                    {l.pdfUrl && (
                      <a
                        href={`${API_BASE}/api/v1/letters/${l.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
                      >
                        <FileDown className="mr-1 h-4 w-4" />
                        Download
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
