'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, DollarSign, TrendingUp, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import {
  useEquityGrant,
  useCancelEquityGrantMutation,
  type VestingEvent,
} from '@/hooks/use-equity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRC = React.ComponentType<any>;

interface RechartsComponents {
  AreaChart: AnyRC;
  Area: AnyRC;
  XAxis: AnyRC;
  YAxis: AnyRC;
  CartesianGrid: AnyRC;
  Tooltip: AnyRC;
  ResponsiveContainer: AnyRC;
  ReferenceLine: AnyRC;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val);
}
function formatNumber(val: number): string {
  return new Intl.NumberFormat('en-US').format(val);
}
function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-green-500/20 text-green-700',
    PENDING: 'bg-yellow-500/20 text-yellow-700',
    PARTIALLY_VESTED: 'bg-blue-500/20 text-blue-700',
    FULLY_VESTED: 'bg-purple-500/20 text-purple-700',
    CANCELLED: 'bg-red-500/20 text-red-700',
    EXPIRED: 'bg-gray-500/20 text-gray-700',
    SCHEDULED: 'bg-blue-500/20 text-blue-700',
    VESTED: 'bg-green-500/20 text-green-700',
  };
  return (
    <Badge variant="secondary" className={colors[status] || ''}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

export default function GrantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const grantId = params.id as string;
  const grantQuery = useEquityGrant(grantId);
  const cancelGrant = useCancelEquityGrantMutation();
  const [recharts, setRecharts] = React.useState<RechartsComponents | null>(null);

  React.useEffect(() => {
    import('recharts').then((mod) => {
      setRecharts({
        AreaChart: mod.AreaChart,
        Area: mod.Area,
        XAxis: mod.XAxis,
        YAxis: mod.YAxis,
        CartesianGrid: mod.CartesianGrid,
        Tooltip: mod.Tooltip,
        ResponsiveContainer: mod.ResponsiveContainer,
        ReferenceLine: mod.ReferenceLine,
      });
    });
  }, []);

  if (grantQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const grant = grantQuery.data;
  if (!grant) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Grant not found</p>
      </div>
    );
  }

  const vestingProgress =
    grant.totalShares > 0 ? Math.round((grant.vestedShares / grant.totalShares) * 100) : 0;
  const totalValue = grant.totalShares * Number(grant.currentPrice);
  const vestedValue = grant.vestedShares * Number(grant.currentPrice);
  const unvestedValue = (grant.totalShares - grant.vestedShares) * Number(grant.currentPrice);

  // Chart data from vesting events
  const chartData = (grant.vestingEvents ?? []).map((e: VestingEvent) => ({
    date: formatDate(e.vestDate),
    shares: e.cumulativeVested,
    status: e.status,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/equity')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {grant.employee ? `${grant.employee.firstName} ${grant.employee.lastName}` : 'Grant'}{' '}
              — {grant.grantType} Grant
            </h1>
            <p className="text-muted-foreground">
              {grant.plan?.name} · Granted {formatDate(grant.grantDate)}
            </p>
          </div>
          {statusBadge(grant.status)}
        </div>
        {grant.status !== 'CANCELLED' && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() =>
              cancelGrant.mutate(grantId, {
                onSuccess: () => {
                  toast({ title: 'Grant cancelled' });
                  router.push('/dashboard/equity');
                },
              })
            }
            disabled={cancelGrant.isPending}
          >
            {cancelGrant.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="mr-2 h-4 w-4" />
            )}
            Cancel Grant
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total Shares</p>
            <p className="text-2xl font-bold">{formatNumber(grant.totalShares)}</p>
            <p className="text-xs text-muted-foreground">
              Grant price: {formatCurrency(Number(grant.grantPrice))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Vested</p>
            <p className="text-2xl font-bold">{formatNumber(grant.vestedShares)}</p>
            <Progress value={vestingProgress} className="mt-2" />
            <p className="mt-1 text-xs text-muted-foreground">{vestingProgress}% vested</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Current Value</p>
            <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
            <p className="text-xs text-muted-foreground">
              Vested: {formatCurrency(vestedValue)} · Unvested: {formatCurrency(unvestedValue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Schedule</p>
            <p className="text-lg font-semibold">{grant.vestingScheduleType.replace(/_/g, ' ')}</p>
            <p className="text-xs text-muted-foreground">
              {grant.cliffMonths}mo cliff · {grant.vestingMonths}mo total
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Vesting Timeline Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" /> Vesting Timeline
          </CardTitle>
          <CardDescription>Cumulative shares vested over time</CardDescription>
        </CardHeader>
        <CardContent>
          {recharts && chartData.length > 0 ? (
            <recharts.ResponsiveContainer width="100%" height={350}>
              <recharts.AreaChart
                data={chartData}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="vestingGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <recharts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <recharts.XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <recharts.YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <recharts.Tooltip
                  formatter={(value: number) => [formatNumber(value), 'Cumulative Shares']}
                />
                <recharts.ReferenceLine
                  y={grant.totalShares}
                  stroke="#ef4444"
                  strokeDasharray="3 3"
                  label={{
                    value: `Total: ${formatNumber(grant.totalShares)}`,
                    position: 'right',
                    fontSize: 12,
                  }}
                />
                <recharts.Area
                  type="stepAfter"
                  dataKey="shares"
                  stroke="#6366f1"
                  fill="url(#vestingGradient)"
                  strokeWidth={2}
                />
              </recharts.AreaChart>
            </recharts.ResponsiveContainer>
          ) : (
            <div className="flex h-[350px] items-center justify-center text-muted-foreground">
              {chartData.length === 0 ? 'No vesting events' : 'Loading chart...'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vesting Events Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" /> Vesting Events
          </CardTitle>
          <CardDescription>{(grant.vestingEvents ?? []).length} scheduled events</CardDescription>
        </CardHeader>
        <CardContent>
          {(grant.vestingEvents ?? []).length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vest Date</TableHead>
                  <TableHead className="text-right">Shares</TableHead>
                  <TableHead className="text-right">Cumulative</TableHead>
                  <TableHead className="text-right">Est. Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grant.vestingEvents ?? []).map((event: VestingEvent) => (
                  <TableRow key={event.id}>
                    <TableCell>{formatDate(event.vestDate)}</TableCell>
                    <TableCell className="text-right">{formatNumber(event.sharesVested)}</TableCell>
                    <TableCell className="text-right">
                      {formatNumber(event.cumulativeVested)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(event.sharesVested * Number(grant.currentPrice))}
                    </TableCell>
                    <TableCell>{statusBadge(event.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-muted-foreground">No vesting events</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
