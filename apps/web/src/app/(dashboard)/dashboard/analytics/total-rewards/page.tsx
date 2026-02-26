'use client';

import * as React from 'react';
import { DollarSign, User, Loader2, Users, FileDown, Send, FileText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import {
  useStatementList,
  useBulkGenerateMutation,
  useSendStatementEmailMutation,
  getStatementDownloadUrl,
} from '@/hooks/use-rewards-statements';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRC = React.ComponentType<any>;

interface RechartsComponents {
  BarChart: AnyRC;
  Bar: AnyRC;
  XAxis: AnyRC;
  YAxis: AnyRC;
  CartesianGrid: AnyRC;
  Tooltip: AnyRC;
  ResponsiveContainer: AnyRC;
  PieChart: AnyRC;
  Pie: AnyRC;
  Cell: AnyRC;
  Legend: AnyRC;
}

interface PersonalRewards {
  employee: { name: string; title: string; department: string; employeeId: string };
  totalRewardsValue: number;
  previousYearTotal: number;
  breakdown: Array<{ category: string; value: number; previousValue: number }>;
  year: number;
}

interface TeamOverview {
  teamSize: number;
  avgTotalRewards: number;
  medianTotalRewards: number;
  departmentBreakdown: Array<{ category: string; avgValue: number }>;
  headcountByLevel: Array<{ level: string; count: number; avgComp: number }>;
}

const COLORS = ['hsl(var(--primary))', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function TotalRewardsPage() {
  const [personal, setPersonal] = React.useState<PersonalRewards | null>(null);
  const [team, setTeam] = React.useState<TeamOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [teamLoading, setTeamLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState('personal');

  const [RC, setRC] = React.useState<RechartsComponents | null>(null);
  React.useEffect(() => {
    import('recharts').then((mod) => {
      setRC({
        BarChart: mod.BarChart,
        Bar: mod.Bar,
        XAxis: mod.XAxis,
        YAxis: mod.YAxis,
        CartesianGrid: mod.CartesianGrid,
        Tooltip: mod.Tooltip,
        ResponsiveContainer: mod.ResponsiveContainer,
        PieChart: mod.PieChart,
        Pie: mod.Pie,
        Cell: mod.Cell,
        Legend: mod.Legend,
      } as RechartsComponents);
    });
  }, []);

  React.useEffect(() => {
    setLoading(true);
    apiClient
      .fetch<PersonalRewards>('/api/v1/analytics/total-rewards')
      .then(setPersonal)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const loadTeam = React.useCallback(() => {
    if (team) return;
    setTeamLoading(true);
    apiClient
      .fetch<TeamOverview>('/api/v1/analytics/total-rewards?view=team')
      .then(setTeam)
      .catch(() => {
        /* team view may be forbidden for non-managers */
      })
      .finally(() => setTeamLoading(false));
  }, [team]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Total Rewards</h1>
        <p className="text-muted-foreground">Your complete compensation and benefits overview.</p>
      </div>

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {error && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {personal && !loading && (
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v);
            if (v === 'team') loadTeam();
          }}
        >
          <TabsList>
            <TabsTrigger value="personal">My Rewards</TabsTrigger>
            <TabsTrigger value="team">Team Overview</TabsTrigger>
            <TabsTrigger value="statements">Statements</TabsTrigger>
          </TabsList>

          <TabsContent value="personal" className="space-y-6 mt-4">
            {/* Employee Info */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <User className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{personal.employee.name}</CardTitle>
                    <CardDescription>
                      {personal.employee.title} · {personal.employee.department}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="ml-auto">
                    {personal.year}
                  </Badge>
                </div>
              </CardHeader>
            </Card>

            {/* Total Rewards Value */}
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Rewards Value</CardDescription>
                <CardTitle className="text-3xl">
                  {formatCurrency(personal.totalRewardsValue)}
                </CardTitle>
              </CardHeader>
            </Card>

            {/* Breakdown Chart & Table */}
            {personal.breakdown.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Pie Chart */}
                {RC && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Compensation Breakdown</CardTitle>
                      <CardDescription>Components of your total rewards package.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <RC.ResponsiveContainer width="100%" height="100%">
                          <RC.PieChart>
                            <RC.Pie
                              data={personal.breakdown}
                              dataKey="value"
                              nameKey="category"
                              cx="50%"
                              cy="50%"
                              outerRadius={90}
                              label={({ category, value }: { category: string; value: number }) =>
                                `${category}: ${formatCurrency(value)}`
                              }
                            >
                              {personal.breakdown.map((_, idx) => (
                                <RC.Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                              ))}
                            </RC.Pie>
                            <RC.Tooltip formatter={(value: number) => formatCurrency(value)} />
                          </RC.PieChart>
                        </RC.ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Breakdown Table */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Breakdown Details</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {personal.breakdown.map((row) => (
                          <TableRow key={row.category}>
                            <TableCell className="font-medium">{row.category}</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(row.value)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="font-bold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(personal.totalRewardsValue)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}

            {personal.breakdown.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <DollarSign className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">
                    No compensation data linked to your account
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ask your HR admin to link your employee record.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="team" className="space-y-6 mt-4">
            {teamLoading && (
              <div className="space-y-4">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            )}

            {team && !teamLoading && (
              <>
                {/* Team Summary */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Team Size</CardDescription>
                      <CardTitle className="text-2xl flex items-center gap-2">
                        <Users className="h-5 w-5 text-muted-foreground" />
                        {team.teamSize}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Avg Total Rewards</CardDescription>
                      <CardTitle className="text-2xl">
                        {formatCurrency(team.avgTotalRewards)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Median Total Rewards</CardDescription>
                      <CardTitle className="text-2xl">
                        {formatCurrency(team.medianTotalRewards)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                </div>

                {/* Dept Breakdown Chart */}
                {RC && team.departmentBreakdown.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Average Compensation by Department
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <RC.ResponsiveContainer width="100%" height="100%">
                          <RC.BarChart data={team.departmentBreakdown}>
                            <RC.CartesianGrid strokeDasharray="3 3" />
                            <RC.XAxis dataKey="category" />
                            <RC.YAxis />
                            <RC.Tooltip formatter={(value: number) => formatCurrency(value)} />
                            <RC.Bar
                              dataKey="avgValue"
                              name="Avg Comp"
                              fill="hsl(var(--primary))"
                              radius={[4, 4, 0, 0]}
                            />
                          </RC.BarChart>
                        </RC.ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Headcount by Level Table */}
                {team.headcountByLevel.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Headcount by Level</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Level</TableHead>
                            <TableHead className="text-right">Count</TableHead>
                            <TableHead className="text-right">Avg Comp</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {team.headcountByLevel.map((row) => (
                            <TableRow key={row.level}>
                              <TableCell className="font-medium">{row.level}</TableCell>
                              <TableCell className="text-right">{row.count}</TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(row.avgComp)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {team.teamSize === 0 && (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Users className="mx-auto h-8 w-8 text-muted-foreground" />
                      <p className="mt-2 text-sm font-medium">No team data available</p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {!team && !teamLoading && (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">Team view not available</p>
                  <p className="text-xs text-muted-foreground">
                    Only managers and HR can view team rewards.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="statements" className="space-y-6 mt-4">
            <StatementsPanel />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function StatementsPanel() {
  const { data: statementsData, isLoading } = useStatementList();
  const bulkGenerate = useBulkGenerateMutation();
  const sendEmail = useSendStatementEmailMutation();

  const statusColor = (s: string) => {
    switch (s) {
      case 'GENERATED':
        return 'default';
      case 'SENT':
        return 'secondary';
      case 'FAILED':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">PDF Statements</h3>
          <p className="text-sm text-muted-foreground">
            Generate and manage total rewards PDF statements for employees.
          </p>
        </div>
        <Button onClick={() => bulkGenerate.mutate({})} disabled={bulkGenerate.isPending}>
          {bulkGenerate.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileText className="mr-2 h-4 w-4" />
          )}
          Generate All Statements
        </Button>
      </div>

      {bulkGenerate.isSuccess && (
        <Card>
          <CardContent className="py-3">
            <p className="text-sm text-green-600">
              ✅ Generated {bulkGenerate.data.generated} of {bulkGenerate.data.total} statements.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading && <Skeleton className="h-64 w-full" />}

      {statementsData && statementsData.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statement History</CardTitle>
            <CardDescription>{statementsData.total} statements generated</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statementsData.data.map((stmt) => (
                  <TableRow key={stmt.id}>
                    <TableCell className="font-medium">
                      {stmt.employee
                        ? `${stmt.employee.firstName} ${stmt.employee.lastName}`
                        : stmt.employeeId}
                    </TableCell>
                    <TableCell>{stmt.employee?.department ?? '—'}</TableCell>
                    <TableCell>{stmt.year}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          statusColor(stmt.status) as
                            | 'default'
                            | 'secondary'
                            | 'destructive'
                            | 'outline'
                        }
                      >
                        {stmt.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(stmt.generatedAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right space-x-1">
                      {stmt.pdfUrl && (
                        <a
                          href={getStatementDownloadUrl(stmt.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-md text-sm font-medium h-8 w-8 hover:bg-accent hover:text-accent-foreground"
                        >
                          <FileDown className="h-4 w-4" />
                        </a>
                      )}
                      {stmt.status === 'GENERATED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => sendEmail.mutate(stmt.id)}
                          disabled={sendEmail.isPending}
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {statementsData && statementsData.data.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No statements generated yet</p>
            <p className="text-xs text-muted-foreground">
              Click &quot;Generate All Statements&quot; to create PDF statements for all employees.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
