'use client';

import * as React from 'react';
import {
  Plus,
  Loader2,
  TrendingUp,
  DollarSign,
  PieChart,
  Users,
  Calendar,
  ArrowRight,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import {
  useEquityPlans,
  useEquityGrants,
  useEquityDashboard,
  useCreateEquityPlanMutation,
  useDeleteEquityPlanMutation,
  useCreateEquityGrantMutation,
  useCancelEquityGrantMutation,
  type EquityPlan,
  type EquityGrant,
} from '@/hooks/use-equity';
import Link from 'next/link';

/* ─── Helpers ───────────────────────────────────────── */

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
  };
  return (
    <Badge variant="secondary" className={colors[status] || ''}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

function grantTypeBadge(type: string) {
  const colors: Record<string, string> = {
    RSU: 'bg-indigo-500/20 text-indigo-700',
    ISO: 'bg-emerald-500/20 text-emerald-700',
    NSO: 'bg-amber-500/20 text-amber-700',
    SAR: 'bg-cyan-500/20 text-cyan-700',
    PHANTOM: 'bg-pink-500/20 text-pink-700',
  };
  return (
    <Badge variant="secondary" className={colors[type] || ''}>
      {type}
    </Badge>
  );
}

/* ─── Page Component ────────────────────────────────── */

export default function EquityPage() {
  const [activeTab, setActiveTab] = React.useState('dashboard');
  const [showCreatePlan, setShowCreatePlan] = React.useState(false);
  const [showCreateGrant, setShowCreateGrant] = React.useState(false);
  const { toast } = useToast();

  const dashboardQuery = useEquityDashboard();
  const plansQuery = useEquityPlans();
  const grantsQuery = useEquityGrants();
  const createPlan = useCreateEquityPlanMutation();
  const deletePlan = useDeleteEquityPlanMutation();
  const createGrant = useCreateEquityGrantMutation();
  const cancelGrant = useCancelEquityGrantMutation();

  const isLoading = dashboardQuery.isLoading;
  const dashboard = dashboardQuery.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Equity & Stock Plans</h1>
          <p className="text-muted-foreground">
            Manage equity plans, grants, vesting schedules, and employee portfolios
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCreatePlan(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Plan
          </Button>
          <Button onClick={() => setShowCreateGrant(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Grant
          </Button>
        </div>
      </div>

      {/* Dashboard Stats */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : dashboard ? (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10">
                  <PieChart className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Plans</p>
                  <p className="text-2xl font-bold">{dashboard.plans}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <DollarSign className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Equity Value</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(dashboard.totalCurrentValue)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                  <TrendingUp className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Dilution</p>
                  <p className="text-2xl font-bold">{dashboard.dilutionPercent}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <Users className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Grants</p>
                  <p className="text-2xl font-bold">{dashboard.totalGrants}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="grants">Grants</TabsTrigger>
        </TabsList>

        {/* Dashboard Tab — Upcoming Vests */}
        <TabsContent value="dashboard" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" /> Upcoming Vesting Events (Next 90 Days)
              </CardTitle>
              <CardDescription>Scheduled vesting events across all active grants</CardDescription>
            </CardHeader>
            <CardContent>
              {dashboardQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : dashboard && dashboard.upcomingVests.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Vest Date</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">Est. Value</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.upcomingVests.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">{v.employeeName}</TableCell>
                        <TableCell>{formatDate(v.vestDate)}</TableCell>
                        <TableCell className="text-right">{formatNumber(v.sharesVested)}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(v.estimatedValue)}
                        </TableCell>
                        <TableCell>
                          <Link href={`/dashboard/equity/grants/${v.grantId}`}>
                            <Button variant="ghost" size="sm">
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-8 text-center text-muted-foreground">No upcoming vesting events</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Plans Tab */}
        <TabsContent value="plans" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Equity Plans</CardTitle>
              <CardDescription>All equity compensation plans</CardDescription>
            </CardHeader>
            <CardContent>
              {plansQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : plansQuery.data && plansQuery.data.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Authorized</TableHead>
                      <TableHead className="text-right">Issued</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Share Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Grants</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plansQuery.data.data.map((plan) => (
                      <TableRow key={plan.id}>
                        <TableCell className="font-medium">{plan.name}</TableCell>
                        <TableCell>{grantTypeBadge(plan.planType)}</TableCell>
                        <TableCell className="text-right">
                          {formatNumber(plan.totalSharesAuthorized)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(plan.sharesIssued)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(plan.sharesAvailable)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(plan.sharePrice))}
                        </TableCell>
                        <TableCell>
                          <Badge variant={plan.isActive ? 'default' : 'secondary'}>
                            {plan.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>{plan._count?.grants ?? 0}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              deletePlan.mutate(plan.id, {
                                onSuccess: () => toast({ title: 'Plan deleted' }),
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-8 text-center text-muted-foreground">
                  No equity plans yet. Create one to get started.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Grants Tab */}
        <TabsContent value="grants" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Equity Grants</CardTitle>
              <CardDescription>All equity grants across employees</CardDescription>
            </CardHeader>
            <CardContent>
              {grantsQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : grantsQuery.data && grantsQuery.data.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Grant Date</TableHead>
                      <TableHead className="text-right">Total Shares</TableHead>
                      <TableHead className="text-right">Vested</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grantsQuery.data.data.map((grant) => (
                      <TableRow key={grant.id}>
                        <TableCell className="font-medium">
                          {grant.employee
                            ? `${grant.employee.firstName} ${grant.employee.lastName}`
                            : '—'}
                        </TableCell>
                        <TableCell>{grant.plan?.name ?? '—'}</TableCell>
                        <TableCell>{grantTypeBadge(grant.grantType)}</TableCell>
                        <TableCell>{formatDate(grant.grantDate)}</TableCell>
                        <TableCell className="text-right">
                          {formatNumber(grant.totalShares)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(grant.vestedShares)}
                        </TableCell>
                        <TableCell>{statusBadge(grant.status)}</TableCell>
                        <TableCell>
                          <Link href={`/dashboard/equity/grants/${grant.id}`}>
                            <Button variant="ghost" size="sm">
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-8 text-center text-muted-foreground">No equity grants yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Plan Dialog */}
      <CreatePlanDialog
        open={showCreatePlan}
        onOpenChange={setShowCreatePlan}
        onSubmit={(data) => {
          createPlan.mutate(data, {
            onSuccess: () => {
              setShowCreatePlan(false);
              toast({ title: 'Equity plan created' });
            },
          });
        }}
        isLoading={createPlan.isPending}
      />

      {/* Create Grant Dialog */}
      <CreateGrantDialog
        open={showCreateGrant}
        onOpenChange={setShowCreateGrant}
        plans={plansQuery.data?.data ?? []}
        onSubmit={(data) => {
          createGrant.mutate(data, {
            onSuccess: () => {
              setShowCreateGrant(false);
              toast({ title: 'Equity grant created with vesting schedule' });
            },
          });
        }}
        isLoading={createGrant.isPending}
      />
    </div>
  );
}

/* ─── Create Plan Dialog ────────────────────────────── */

function CreatePlanDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: {
    name: string;
    planType: string;
    totalSharesAuthorized: number;
    sharePrice: number;
    effectiveDate: string;
    description?: string;
  }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = React.useState('');
  const [planType, setPlanType] = React.useState('RSU');
  const [totalShares, setTotalShares] = React.useState('');
  const [sharePrice, setSharePrice] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [description, setDescription] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Equity Plan</DialogTitle>
          <DialogDescription>Set up a new equity compensation plan</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Plan Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="2026 RSU Plan"
            />
          </div>
          <div>
            <Label>Plan Type</Label>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={planType}
              onChange={(e) => setPlanType(e.target.value)}
            >
              <option value="RSU">RSU</option>
              <option value="ISO">ISO</option>
              <option value="NSO">NSO</option>
              <option value="SAR">SAR</option>
              <option value="PHANTOM">Phantom</option>
            </select>
          </div>
          <div>
            <Label>Total Shares Authorized</Label>
            <Input
              type="number"
              value={totalShares}
              onChange={(e) => setTotalShares(e.target.value)}
              placeholder="10000000"
            />
          </div>
          <div>
            <Label>Share Price ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={sharePrice}
              onChange={(e) => setSharePrice(e.target.value)}
              placeholder="42.50"
            />
          </div>
          <div>
            <Label>Effective Date</Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          <div>
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name || !totalShares || !sharePrice || !effectiveDate || isLoading}
            onClick={() =>
              onSubmit({
                name,
                planType,
                totalSharesAuthorized: Number(totalShares),
                sharePrice: Number(sharePrice),
                effectiveDate: new Date(effectiveDate).toISOString(),
                description: description || undefined,
              })
            }
          >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Create Grant Dialog ───────────────────────────── */

function CreateGrantDialog({
  open,
  onOpenChange,
  plans,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plans: EquityPlan[];
  onSubmit: (data: {
    employeeId: string;
    planId: string;
    grantType: string;
    grantDate: string;
    totalShares: number;
    grantPrice: number;
    vestingScheduleType: string;
    cliffMonths?: number;
    vestingMonths?: number;
  }) => void;
  isLoading: boolean;
}) {
  const [employeeId, setEmployeeId] = React.useState('');
  const [planId, setPlanId] = React.useState('');
  const [grantType, setGrantType] = React.useState('RSU');
  const [grantDate, setGrantDate] = React.useState('');
  const [totalShares, setTotalShares] = React.useState('');
  const [grantPrice, setGrantPrice] = React.useState('');
  const [vestingSchedule, setVestingSchedule] = React.useState('STANDARD_4Y_1Y_CLIFF');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Equity Grant</DialogTitle>
          <DialogDescription>
            Issue a new equity grant to an employee. Vesting events are auto-generated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Employee ID</Label>
            <Input
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="Employee ID"
            />
          </div>
          <div>
            <Label>Plan</Label>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
            >
              <option value="">Select a plan...</option>
              {plans
                .filter((p) => p.isActive)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.planType})
                  </option>
                ))}
            </select>
          </div>
          <div>
            <Label>Grant Type</Label>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={grantType}
              onChange={(e) => setGrantType(e.target.value)}
            >
              <option value="RSU">RSU</option>
              <option value="ISO">ISO</option>
              <option value="NSO">NSO</option>
              <option value="SAR">SAR</option>
              <option value="PHANTOM">Phantom</option>
            </select>
          </div>
          <div>
            <Label>Grant Date</Label>
            <Input type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)} />
          </div>
          <div>
            <Label>Total Shares</Label>
            <Input
              type="number"
              value={totalShares}
              onChange={(e) => setTotalShares(e.target.value)}
              placeholder="5000"
            />
          </div>
          <div>
            <Label>Grant Price ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={grantPrice}
              onChange={(e) => setGrantPrice(e.target.value)}
              placeholder="42.50"
            />
          </div>
          <div>
            <Label>Vesting Schedule</Label>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={vestingSchedule}
              onChange={(e) => setVestingSchedule(e.target.value)}
            >
              <option value="STANDARD_4Y_1Y_CLIFF">Standard 4-Year / 1-Year Cliff</option>
              <option value="MONTHLY">Monthly (No Cliff)</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="ANNUAL">Annual</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !employeeId || !planId || !grantDate || !totalShares || !grantPrice || isLoading
            }
            onClick={() =>
              onSubmit({
                employeeId,
                planId,
                grantType,
                grantDate: new Date(grantDate).toISOString(),
                totalShares: Number(totalShares),
                grantPrice: Number(grantPrice),
                vestingScheduleType: vestingSchedule,
              })
            }
          >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create Grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
