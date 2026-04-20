'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { FlaskConical, Play } from 'lucide-react';

interface RuleSetSummary {
  id: string;
  name: string;
  status: string;
  version: number;
  ruleCount: number;
}

interface RuleSetsResponse {
  data: RuleSetSummary[];
  total: number;
}

interface SimulationResult {
  id: string;
  summary: {
    totalEmployees: number;
    affectedEmployees: number;
    averageChange: number;
    minChange: number;
    maxChange: number;
  };
  departmentBreakdown: { department: string; avgChange: number; count: number }[];
  distribution: { range: string; count: number }[];
  details: {
    employeeId: string;
    employeeName: string;
    department: string;
    before: number;
    after: number;
    change: number;
    changePercent: number;
  }[];
}

export default function SimulatorPage() {
  const { toast } = useToast();
  const [selectedRuleSet, setSelectedRuleSet] = React.useState('');
  const [simResult, setSimResult] = React.useState<SimulationResult | null>(null);
  const [simRunning, setSimRunning] = React.useState(false);

  const [RechartsComponents, setRechartsComponents] = React.useState<{
    BarChart: React.ComponentType<Record<string, unknown>>;
    Bar: React.ComponentType<Record<string, unknown>>;
    XAxis: React.ComponentType<Record<string, unknown>>;
    YAxis: React.ComponentType<Record<string, unknown>>;
    CartesianGrid: React.ComponentType<Record<string, unknown>>;
    Tooltip: React.ComponentType<Record<string, unknown>>;
    ResponsiveContainer: React.ComponentType<Record<string, unknown>>;
  } | null>(null);

  React.useEffect(() => {
    import('recharts').then((mod) => {
      setRechartsComponents({
        BarChart: mod.BarChart as unknown as React.ComponentType<Record<string, unknown>>,
        Bar: mod.Bar as unknown as React.ComponentType<Record<string, unknown>>,
        XAxis: mod.XAxis as unknown as React.ComponentType<Record<string, unknown>>,
        YAxis: mod.YAxis as unknown as React.ComponentType<Record<string, unknown>>,
        CartesianGrid: mod.CartesianGrid as unknown as React.ComponentType<Record<string, unknown>>,
        Tooltip: mod.Tooltip as unknown as React.ComponentType<Record<string, unknown>>,
        ResponsiveContainer: mod.ResponsiveContainer as unknown as React.ComponentType<
          Record<string, unknown>
        >,
      });
    });
  }, []);

  const { data: ruleSetsData, isLoading } = useQuery<RuleSetsResponse>({
    queryKey: ['rule-sets'],
    queryFn: () => apiClient.fetch<RuleSetsResponse>('/api/v1/rules/rule-sets?page=1&limit=100'),
  });

  const ruleSets = ruleSetsData?.data ?? [];

  async function runSimulation() {
    if (!selectedRuleSet) return;
    setSimRunning(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await apiClient.fetch<any>(
        `/api/v1/rules/rule-sets/${selectedRuleSet}/simulate`,
        { method: 'POST', body: JSON.stringify({}) },
      );

      // Transform API response to frontend format
      const results = raw.results ?? [];
      const changes = results.map((r: { changePercent: number }) => r.changePercent);
      const affected = results.filter(
        (r: { changePercent: number }) => r.changePercent !== 0,
      ).length;

      // Department breakdown
      const deptMap = new Map<string, { total: number; count: number }>();
      for (const r of results) {
        const d = deptMap.get(r.department) ?? { total: 0, count: 0 };
        d.total += r.changePercent;
        d.count++;
        deptMap.set(r.department, d);
      }

      // Distribution buckets
      const buckets = ['0%', '1-3%', '3-5%', '5-8%', '8-12%', '12%+'];
      const dist = buckets.map((range) => ({ range, count: 0 }));
      for (const c of changes) {
        const abs = Math.abs(c);
        if (abs === 0) dist[0]!.count++;
        else if (abs <= 3) dist[1]!.count++;
        else if (abs <= 5) dist[2]!.count++;
        else if (abs <= 8) dist[3]!.count++;
        else if (abs <= 12) dist[4]!.count++;
        else dist[5]!.count++;
      }

      const result: SimulationResult = {
        id: raw.simulationRunId ?? 'sim',
        summary: {
          totalEmployees: results.length,
          affectedEmployees: affected,
          averageChange:
            changes.length > 0
              ? changes.reduce((a: number, b: number) => a + b, 0) / changes.length
              : 0,
          minChange: changes.length > 0 ? Math.min(...changes) : 0,
          maxChange: changes.length > 0 ? Math.max(...changes) : 0,
        },
        departmentBreakdown: Array.from(deptMap.entries()).map(([dept, d]) => ({
          department: dept,
          avgChange: Math.round((d.total / d.count) * 100) / 100,
          count: d.count,
        })),
        distribution: dist,
        details: results
          .slice(0, 100)
          .map(
            (r: {
              employeeId: string;
              name: string;
              department: string;
              before: { baseSalary: number };
              after: { newTotal: number };
              changePercent: number;
            }) => ({
              employeeId: r.employeeId,
              employeeName: r.name,
              department: r.department,
              before: r.before?.baseSalary ?? 0,
              after: r.after?.newTotal ?? 0,
              change: (r.after?.newTotal ?? 0) - (r.before?.baseSalary ?? 0),
              changePercent: r.changePercent,
            }),
          ),
      };

      setSimResult(result);
      toast({ title: 'Simulation complete' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSimRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Simulator</h1>
        <p className="text-muted-foreground">
          Run compensation rule simulations with different scenarios.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Quick Simulation
          </CardTitle>
          <CardDescription>
            Select a rule set and run a simulation to see the impact.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Select
                  options={ruleSets.map((rs) => ({
                    value: rs.id,
                    label: `${rs.name} (v${rs.version})`,
                  }))}
                  placeholder="Select a rule set..."
                  value={selectedRuleSet}
                  onChange={(e) => setSelectedRuleSet(e.target.value)}
                />
              </div>
              <Button onClick={runSimulation} disabled={!selectedRuleSet || simRunning}>
                <Play className="mr-2 h-4 w-4" />
                {simRunning ? 'Running...' : 'Run Simulation'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {simResult && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{simResult.summary.totalEmployees}</div>
                <p className="text-xs text-muted-foreground">Total Employees</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{simResult.summary.affectedEmployees}</div>
                <p className="text-xs text-muted-foreground">Affected</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">
                  {simResult.summary.averageChange.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">Avg Change</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">
                  {simResult.summary.minChange.toFixed(1)}% –{' '}
                  {simResult.summary.maxChange.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">Range</p>
              </CardContent>
            </Card>
          </div>

          {RechartsComponents && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By Department</CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ width: '100%', height: 300 }}>
                    <RechartsComponents.ResponsiveContainer width="100%" height="100%">
                      <RechartsComponents.BarChart data={simResult.departmentBreakdown}>
                        <RechartsComponents.CartesianGrid strokeDasharray="3 3" />
                        <RechartsComponents.XAxis dataKey="department" />
                        <RechartsComponents.YAxis />
                        <RechartsComponents.Tooltip />
                        <RechartsComponents.Bar
                          dataKey="avgChange"
                          fill="hsl(var(--primary))"
                          name="Avg Change %"
                        />
                      </RechartsComponents.BarChart>
                    </RechartsComponents.ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ width: '100%', height: 300 }}>
                    <RechartsComponents.ResponsiveContainer width="100%" height="100%">
                      <RechartsComponents.BarChart data={simResult.distribution}>
                        <RechartsComponents.CartesianGrid strokeDasharray="3 3" />
                        <RechartsComponents.XAxis dataKey="range" />
                        <RechartsComponents.YAxis />
                        <RechartsComponents.Tooltip />
                        <RechartsComponents.Bar
                          dataKey="count"
                          fill="hsl(var(--secondary))"
                          name="Employees"
                        />
                      </RechartsComponents.BarChart>
                    </RechartsComponents.ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Before</TableHead>
                    <TableHead className="text-right">After</TableHead>
                    <TableHead className="text-right">Change %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {simResult.details.slice(0, 50).map((d) => (
                    <TableRow key={d.employeeId}>
                      <TableCell className="font-medium">{d.employeeName}</TableCell>
                      <TableCell>{d.department}</TableCell>
                      <TableCell className="text-right">${d.before.toLocaleString()}</TableCell>
                      <TableCell className="text-right">${d.after.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={d.changePercent >= 0 ? 'default' : 'destructive'}>
                          {d.changePercent >= 0 ? '+' : ''}
                          {d.changePercent.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
