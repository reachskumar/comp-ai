'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import {
  useAttritionDashboard,
  useAttritionScores,
  useAttritionEmployeeScore,
  useRunAttritionAnalysis,
  type AttritionScore,
} from '@/hooks/use-attrition';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRC = React.ComponentType<any>;
interface RC {
  PieChart: AnyRC;
  Pie: AnyRC;
  Cell: AnyRC;
  BarChart: AnyRC;
  Bar: AnyRC;
  XAxis: AnyRC;
  YAxis: AnyRC;
  CartesianGrid: AnyRC;
  Tooltip: AnyRC;
  ResponsiveContainer: AnyRC;
  Legend: AnyRC;
}

const RISK_COLORS: Record<string, string> = {
  LOW: '#22c55e',
  MEDIUM: '#f59e0b',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function RiskBadge({ level }: { level: string }) {
  const variant =
    level === 'CRITICAL' || level === 'HIGH'
      ? 'destructive'
      : level === 'MEDIUM'
        ? 'secondary'
        : 'outline';
  return <Badge variant={variant as 'destructive' | 'secondary' | 'outline'}>{level}</Badge>;
}

function RiskGauge({ score }: { score: number }) {
  const color =
    score >= 76 ? '#ef4444' : score >= 51 ? '#f97316' : score >= 26 ? '#f59e0b' : '#22c55e';
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-4 w-32 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-lg font-bold" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export default function AttritionPage() {
  const { toast } = useToast();
  const [riskFilter, setRiskFilter] = React.useState<string>('ALL');
  const [deptFilter, setDeptFilter] = React.useState<string>('ALL');
  const [selectedEmployee, setSelectedEmployee] = React.useState<string | null>(null);

  const dashboard = useAttritionDashboard();
  const scores = useAttritionScores({
    riskLevel: riskFilter !== 'ALL' ? riskFilter : undefined,
    department: deptFilter !== 'ALL' ? deptFilter : undefined,
  });
  const employeeDetail = useAttritionEmployeeScore(selectedEmployee);
  const analyzeMutation = useRunAttritionAnalysis();

  const [RC, setRC] = React.useState<RC | null>(null);
  React.useEffect(() => {
    import('recharts').then((mod) => {
      setRC({
        PieChart: mod.PieChart,
        Pie: mod.Pie,
        Cell: mod.Cell,
        BarChart: mod.BarChart,
        Bar: mod.Bar,
        XAxis: mod.XAxis,
        YAxis: mod.YAxis,
        CartesianGrid: mod.CartesianGrid,
        Tooltip: mod.Tooltip,
        ResponsiveContainer: mod.ResponsiveContainer,
        Legend: mod.Legend,
      } as RC);
    });
  }, []);

  const handleAnalyze = () => {
    analyzeMutation.mutate(undefined, {
      onSuccess: (data) =>
        toast({
          title: 'Analysis Complete',
          description: `Analyzed ${data.totalEmployees} employees. ${data.criticalCount} critical, ${data.highRiskCount} high risk.`,
        }),
      onError: (err) =>
        toast({ title: 'Analysis Failed', description: err.message, variant: 'destructive' }),
    });
  };

  const d = dashboard.data;
  const pieData = d
    ? Object.entries(d.distribution)
        .map(([name, value]) => ({ name, value }))
        .filter((x) => x.value > 0)
    : [];
  const departments = d ? d.departmentBreakdown.map((x) => x.department) : [];

  // Detail view
  if (selectedEmployee && employeeDetail.data) {
    const ed = employeeDetail.data;
    const factors = ed.factors as Record<string, unknown>;
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => setSelectedEmployee(null)}>
            ← Back
          </Button>
          <h1 className="text-2xl font-bold">{ed.employeeName}</h1>
          <RiskBadge level={ed.riskLevel} />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Risk Score</CardTitle>
            </CardHeader>
            <CardContent>
              <RiskGauge score={ed.riskScore} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Department</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold">{ed.department}</p>
              <p className="text-sm text-muted-foreground">{ed.level}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Compensation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold">{formatCurrency(ed.baseSalary)}</p>
              <p className="text-sm text-muted-foreground">
                Compa-ratio: {ed.compaRatio?.toFixed(2) ?? 'N/A'}
              </p>
            </CardContent>
          </Card>
        </div>
        {/* Factor breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Risk Factor Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                {
                  label: 'Compa-Ratio Risk',
                  value: (factors.compaRatioRisk as number) ?? 0,
                  max: 30,
                },
                { label: 'Tenure Risk', value: (factors.tenureRisk as number) ?? 0, max: 20 },
                {
                  label: 'Performance-Pay Gap',
                  value: (factors.performancePayGap as number) ?? 0,
                  max: 25,
                },
                {
                  label: 'Time Since Increase',
                  value: (factors.timeSinceIncrease as number) ?? 0,
                  max: 20,
                },
                {
                  label: 'Market Position',
                  value: (factors.marketPosition as number) ?? 0,
                  max: 20,
                },
                {
                  label: 'Department Turnover',
                  value: (factors.departmentTurnover as number) ?? 0,
                  max: 10,
                },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <span className="w-48 text-sm">{f.label}</span>
                  <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(0, (f.value / f.max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-sm font-medium">
                    {f.value > 0 ? `+${f.value}` : f.value}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        {ed.recommendation && (
          <Card>
            <CardHeader>
              <CardTitle>AI Recommendation</CardTitle>
              <CardDescription>Generated retention strategy</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-sm">{ed.recommendation}</div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Main dashboard
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Retention Risk Dashboard</h1>
          <p className="text-muted-foreground">Predictive attrition analysis powered by AI</p>
        </div>
        <Button onClick={handleAnalyze} disabled={analyzeMutation.isPending}>
          {analyzeMutation.isPending ? 'Analyzing...' : 'Run Analysis'}
        </Button>
      </div>
      {/* Summary Cards */}
      {d && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{d.totalEmployees}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Avg Risk Score</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{d.avgRiskScore}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-600">High Risk</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">{d.distribution.HIGH}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600">Critical Risk</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">{d.distribution.CRITICAL}</p>
            </CardContent>
          </Card>
        </div>
      )}
      {/* Charts row */}
      {d && RC && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Pie */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Risk Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <RC.ResponsiveContainer width="100%" height="100%">
                  <RC.PieChart>
                    <RC.Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ name, value }: { name: string; value: number }) =>
                        `${name}: ${value}`
                      }
                    >
                      {pieData.map((entry) => (
                        <RC.Cell key={entry.name} fill={RISK_COLORS[entry.name] ?? '#888'} />
                      ))}
                    </RC.Pie>
                    <RC.Tooltip />
                    <RC.Legend />
                  </RC.PieChart>
                </RC.ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          {/* Department heatmap bar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Department Risk</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <RC.ResponsiveContainer width="100%" height="100%">
                  <RC.BarChart data={d.departmentBreakdown}>
                    <RC.CartesianGrid strokeDasharray="3 3" />
                    <RC.XAxis dataKey="department" />
                    <RC.YAxis />
                    <RC.Tooltip />
                    <RC.Bar
                      dataKey="avgScore"
                      name="Avg Score"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                  </RC.BarChart>
                </RC.ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {/* Filters + Table */}
      <Card>
        <CardHeader>
          <CardTitle>Employee Risk Scores</CardTitle>
          <div className="flex gap-2 mt-2">
            <Select
              className="w-36"
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              options={[
                { value: 'ALL', label: 'All Levels' },
                { value: 'CRITICAL', label: 'Critical' },
                { value: 'HIGH', label: 'High' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'LOW', label: 'Low' },
              ]}
            />
            <Select
              className="w-40"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              options={[
                { value: 'ALL', label: 'All Depts' },
                ...departments.map((d) => ({ value: d, label: d })),
              ]}
            />
          </div>
        </CardHeader>
        <CardContent>
          {scores.isLoading ? (
            <p>Loading...</p>
          ) : scores.data && scores.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Salary</TableHead>
                  <TableHead>Compa-Ratio</TableHead>
                  <TableHead>Risk Score</TableHead>
                  <TableHead>Risk Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scores.data.map((s: AttritionScore) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedEmployee(s.employeeId)}
                  >
                    <TableCell className="font-medium">{s.employeeName}</TableCell>
                    <TableCell>{s.department}</TableCell>
                    <TableCell>{s.level}</TableCell>
                    <TableCell>{formatCurrency(s.baseSalary)}</TableCell>
                    <TableCell>{s.compaRatio?.toFixed(2) ?? 'N/A'}</TableCell>
                    <TableCell>
                      <RiskGauge score={s.riskScore} />
                    </TableCell>
                    <TableCell>
                      <RiskBadge level={s.riskLevel} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground">
              No risk scores yet. Click &quot;Run Analysis&quot; to calculate.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
