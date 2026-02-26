'use client';

import * as React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Upload,
  Plus,
  Trash2,
  BarChart3,
  Loader2,
  DollarSign,
  Users,
  Target,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  useSalaryBands,
  useBenchmarkingAnalysis,
  useMarketDataSources,
  useDeleteSalaryBandMutation,
  useCreateSalaryBandMutation,
  useBulkImportBandsMutation,
  useCreateMarketDataSourceMutation,
  type EmployeeAnalysis,
} from '@/hooks/use-benchmarking';

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
  Cell: AnyRC;
  Legend: AnyRC;
  ReferenceLine: AnyRC;
}

/* ─── Helpers ───────────────────────────────────────── */

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val);
}

function positioningBadge(pos: string) {
  if (pos === 'below')
    return (
      <Badge variant="destructive" className="gap-1">
        <TrendingDown className="h-3 w-3" /> Below Range
      </Badge>
    );
  if (pos === 'above')
    return (
      <Badge variant="default" className="gap-1 bg-blue-500 hover:bg-blue-500/80">
        <TrendingUp className="h-3 w-3" /> Above Range
      </Badge>
    );
  if (pos === 'within')
    return (
      <Badge variant="secondary" className="gap-1 bg-green-500/20 text-green-700">
        <Minus className="h-3 w-3" /> Within Range
      </Badge>
    );
  return <Badge variant="outline">Unmatched</Badge>;
}

/* ─── Page Component ────────────────────────────────── */

export default function BenchmarkingPage() {
  const [activeTab, setActiveTab] = React.useState('bands');
  const [recharts, setRecharts] = React.useState<RechartsComponents | null>(null);
  const [showAddBand, setShowAddBand] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [showAddSource, setShowAddSource] = React.useState(false);

  // Load Recharts dynamically (SSR-safe)
  React.useEffect(() => {
    import('recharts').then((mod) => {
      setRecharts({
        BarChart: mod.BarChart,
        Bar: mod.Bar,
        XAxis: mod.XAxis,
        YAxis: mod.YAxis,
        CartesianGrid: mod.CartesianGrid,
        Tooltip: mod.Tooltip,
        ResponsiveContainer: mod.ResponsiveContainer,
        Cell: mod.Cell,
        Legend: mod.Legend,
        ReferenceLine: mod.ReferenceLine,
      });
    });
  }, []);

  const bandsQuery = useSalaryBands();
  const analysisQuery = useBenchmarkingAnalysis();
  const sourcesQuery = useMarketDataSources();
  const deleteBand = useDeleteSalaryBandMutation();
  const createBand = useCreateSalaryBandMutation();
  const bulkImport = useBulkImportBandsMutation();
  const createSource = useCreateMarketDataSourceMutation();

  const isLoading = bandsQuery.isLoading || analysisQuery.isLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Market Pricing & Salary Benchmarking
          </h1>
          <p className="text-muted-foreground">
            Manage salary bands, analyze compa-ratios, and benchmark against market data
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
          <Button size="sm" onClick={() => setShowAddBand(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Band
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-8 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Bands</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analysisQuery.data?.totalBands ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Employees Matched</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {analysisQuery.data?.summary.matchedToBands ?? 0}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}
                  / {analysisQuery.data?.summary.totalEmployees ?? 0}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Compa-Ratio</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {analysisQuery.data?.summary.avgCompaRatio
                  ? `${(analysisQuery.data.summary.avgCompaRatio * 100).toFixed(1)}%`
                  : '—'}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Below Range</CardTitle>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                {analysisQuery.data?.summary.belowRange ?? 0}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="bands">Salary Bands</TabsTrigger>
          <TabsTrigger value="analysis">Compa-Ratio Analysis</TabsTrigger>
          <TabsTrigger value="sources">Data Sources</TabsTrigger>
        </TabsList>

        {/* ─── Salary Bands Tab ─── */}
        <TabsContent value="bands" className="space-y-4">
          {showAddBand && (
            <AddBandForm
              onSubmit={(data) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                createBand.mutate(data as any);
                setShowAddBand(false);
              }}
              onCancel={() => setShowAddBand(false)}
            />
          )}
          {showImport && (
            <ImportForm
              onSubmit={(bands) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                bulkImport.mutate(bands as any);
                setShowImport(false);
              }}
              onCancel={() => setShowImport(false)}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle>Salary Bands</CardTitle>
              <CardDescription>
                Market salary ranges by job family, level, and location
              </CardDescription>
            </CardHeader>
            <CardContent>
              {bandsQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !bandsQuery.data?.data.length ? (
                <div className="py-8 text-center text-muted-foreground">
                  No salary bands configured. Add bands or import from CSV.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job Family</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">P10</TableHead>
                      <TableHead className="text-right">P25</TableHead>
                      <TableHead className="text-right">P50</TableHead>
                      <TableHead className="text-right">P75</TableHead>
                      <TableHead className="text-right">P90</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bandsQuery.data.data.map((band) => (
                      <TableRow key={band.id}>
                        <TableCell className="font-medium">{band.jobFamily}</TableCell>
                        <TableCell>{band.level}</TableCell>
                        <TableCell>{band.location || '—'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(band.p10)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(band.p25)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(band.p50)}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(band.p75)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(band.p90)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{band.source || 'Manual'}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteBand.mutate(band.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Compa-Ratio Analysis Tab ─── */}
        <TabsContent value="analysis" className="space-y-4">
          <CompaRatioAnalysis
            data={analysisQuery.data}
            isLoading={analysisQuery.isLoading}
            recharts={recharts}
          />
        </TabsContent>

        {/* ─── Data Sources Tab ─── */}
        <TabsContent value="sources" className="space-y-4">
          {showAddSource && (
            <AddSourceForm
              onSubmit={(data) => {
                createSource.mutate(data);
                setShowAddSource(false);
              }}
              onCancel={() => setShowAddSource(false)}
            />
          )}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Market Data Sources</CardTitle>
                <CardDescription>Configure where salary benchmark data comes from</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowAddSource(true)}>
                <Plus className="mr-2 h-4 w-4" /> Add Source
              </Button>
            </CardHeader>
            <CardContent>
              {sourcesQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !sourcesQuery.data?.length ? (
                <div className="py-8 text-center text-muted-foreground">
                  No data sources configured.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Sync</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sourcesQuery.data.map((src) => (
                      <TableRow key={src.id}>
                        <TableCell className="font-medium">{src.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{src.provider}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={src.status === 'ACTIVE' ? 'secondary' : 'destructive'}
                            className={
                              src.status === 'ACTIVE' ? 'bg-green-500/20 text-green-700' : ''
                            }
                          >
                            {src.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {src.lastSyncAt ? new Date(src.lastSyncAt).toLocaleDateString() : 'Never'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Add Band Form ─────────────────────────────────── */

function AddBandForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState({
    jobFamily: '',
    level: '',
    location: '',
    p10: '',
    p25: '',
    p50: '',
    p75: '',
    p90: '',
    source: '',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Salary Band</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="Job Family (e.g. Engineering)"
            value={form.jobFamily}
            onChange={(e) => setForm({ ...form, jobFamily: e.target.value })}
          />
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="Level (e.g. IC3)"
            value={form.level}
            onChange={(e) => setForm({ ...form, level: e.target.value })}
          />
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="Location (optional)"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
          {(['p10', 'p25', 'p50', 'p75', 'p90'] as const).map((field) => (
            <input
              key={field}
              className="rounded-md border px-3 py-2 text-sm"
              placeholder={field.toUpperCase()}
              type="number"
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            />
          ))}
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="Source (e.g. Radford 2026)"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              onSubmit({
                jobFamily: form.jobFamily,
                level: form.level,
                location: form.location || undefined,
                p10: Number(form.p10),
                p25: Number(form.p25),
                p50: Number(form.p50),
                p75: Number(form.p75),
                p90: Number(form.p90),
                source: form.source || undefined,
              })
            }
            disabled={!form.jobFamily || !form.level || !form.p50}
          >
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Import Form ───────────────────────────────────── */

function ImportForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (bands: Array<Record<string, unknown>>) => void;
  onCancel: () => void;
}) {
  const [csvText, setCsvText] = React.useState('');

  const handleParse = () => {
    try {
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) return;
      const headers = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
      const bands = lines.slice(1).map((line) => {
        const vals = line.split(',').map((v) => v.trim());
        const row: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          const val = vals[i] || '';
          if (['p10', 'p25', 'p50', 'p75', 'p90'].includes(h)) {
            row[h] = Number(val);
          } else {
            row[h] = val;
          }
        });
        return row;
      });
      onSubmit(bands);
    } catch {
      alert('Failed to parse CSV. Check format.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Salary Bands from CSV</CardTitle>
        <CardDescription>
          Paste CSV with headers: jobFamily, level, location, p10, p25, p50, p75, p90, source
        </CardDescription>
      </CardHeader>
      <CardContent>
        <textarea
          className="w-full rounded-md border px-3 py-2 text-sm font-mono"
          rows={6}
          placeholder="jobFamily,level,location,p10,p25,p50,p75,p90,source&#10;Engineering,IC3,US,80000,95000,115000,135000,155000,Radford 2026"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
        />
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={handleParse} disabled={!csvText.trim()}>
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Add Source Form ────────────────────────────────── */

function AddSourceForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: { name: string; provider: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState('');
  const [provider, setProvider] = React.useState('MANUAL');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Market Data Source</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="Source name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="rounded-md border px-3 py-2 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="MANUAL">Manual</option>
            <option value="SURVEY">Survey</option>
            <option value="API">API</option>
          </select>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => onSubmit({ name, provider })} disabled={!name}>
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Compa-Ratio Analysis Component ────────────────── */

function CompaRatioAnalysis({
  data,
  isLoading,
  recharts,
}: {
  data:
    | {
        employees: EmployeeAnalysis[];
        summary: {
          belowRange: number;
          withinRange: number;
          aboveRange: number;
          avgCompaRatio: number | null;
        };
        totalBands: number;
      }
    | undefined;
  isLoading: boolean;
  recharts: RechartsComponents | null;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (!data?.employees.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No employee data available for analysis. Assign salary bands to employees first.
        </CardContent>
      </Card>
    );
  }

  const matched = data.employees.filter((e) => e.compaRatio !== null);

  // Chart data: compa-ratio by employee
  const chartData = matched
    .sort((a, b) => (a.compaRatio ?? 0) - (b.compaRatio ?? 0))
    .map((e) => ({
      name: `${e.firstName} ${e.lastName.charAt(0)}.`,
      compaRatio: (e.compaRatio ?? 0) * 100,
      fill:
        e.positioning === 'below' ? '#ef4444' : e.positioning === 'above' ? '#3b82f6' : '#22c55e',
    }));

  return (
    <>
      {/* Chart */}
      {recharts && chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" /> Compa-Ratio Distribution
            </CardTitle>
            <CardDescription>
              Employee salary as % of band midpoint (P50). 100% = at market rate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <recharts.ResponsiveContainer width="100%" height={350}>
              <recharts.BarChart
                data={chartData}
                margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
              >
                <recharts.CartesianGrid strokeDasharray="3 3" />
                <recharts.XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <recharts.YAxis domain={[0, 150]} tickFormatter={(v: number) => `${v}%`} />
                <recharts.Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Compa-Ratio']} />
                <recharts.ReferenceLine
                  y={100}
                  stroke="#888"
                  strokeDasharray="3 3"
                  label="Market"
                />
                <recharts.Bar dataKey="compaRatio" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <recharts.Cell key={idx} fill={entry.fill} />
                  ))}
                </recharts.Bar>
              </recharts.BarChart>
            </recharts.ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Employee Table */}
      <Card>
        <CardHeader>
          <CardTitle>Employee Market Positioning</CardTitle>
          <CardDescription>Gap analysis: employees below/above salary band range</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Job Family</TableHead>
                <TableHead className="text-right">Base Salary</TableHead>
                <TableHead className="text-right">Band P50</TableHead>
                <TableHead className="text-right">Compa-Ratio</TableHead>
                <TableHead>Positioning</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.employees.map((emp) => (
                <TableRow key={emp.employeeId}>
                  <TableCell className="font-medium">
                    {emp.firstName} {emp.lastName}
                  </TableCell>
                  <TableCell>{emp.department}</TableCell>
                  <TableCell>{emp.level}</TableCell>
                  <TableCell>{emp.jobFamily || '—'}</TableCell>
                  <TableCell className="text-right">{formatCurrency(emp.baseSalary)}</TableCell>
                  <TableCell className="text-right">
                    {emp.bandP50 ? formatCurrency(emp.bandP50) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {emp.compaRatio ? `${(emp.compaRatio * 100).toFixed(1)}%` : '—'}
                  </TableCell>
                  <TableCell>{positioningBadge(emp.positioning)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
