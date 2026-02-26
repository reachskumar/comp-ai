'use client';

import * as React from 'react';
import { Plus, DollarSign, Clock, CheckCircle2, XCircle, Send, Loader2, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
  useAdHocList,
  useAdHocStats,
  useCreateAdHocMutation,
  useSubmitAdHocMutation,
  useApproveAdHocMutation,
  useRejectAdHocMutation,
  useApplyAdHocMutation,
  type AdHocIncrease,
  type AdHocType,
  type AdHocStatus,
} from '@/hooks/use-adhoc';

const TYPE_LABELS: Record<AdHocType, string> = {
  SPOT_BONUS: 'Spot Bonus',
  RETENTION_BONUS: 'Retention Bonus',
  MARKET_ADJUSTMENT: 'Market Adjustment',
  PROMOTION: 'Promotion',
  EQUITY_ADJUSTMENT: 'Equity Adjustment',
  OTHER: 'Other',
};

const STATUS_COLORS: Record<AdHocStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  APPLIED: 'bg-blue-100 text-blue-800',
};

const STATUS_LABELS: Record<AdHocStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  APPLIED: 'Applied',
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function formatCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function AdHocPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [showCreate, setShowCreate] = React.useState(false);
  const [showReject, setShowReject] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');

  const { data: listData, isLoading } = useAdHocList({
    status: statusFilter || undefined,
    type: typeFilter || undefined,
    page,
  });
  const { data: stats, isLoading: statsLoading } = useAdHocStats();

  const submitMutation = useSubmitAdHocMutation();
  const approveMutation = useApproveAdHocMutation();
  const rejectMutation = useRejectAdHocMutation();
  const applyMutation = useApplyAdHocMutation();

  // ─── Form state ───
  const [formEmployeeId, setFormEmployeeId] = React.useState('');
  const [formType, setFormType] = React.useState<string>('SPOT_BONUS');
  const [formReason, setFormReason] = React.useState('');
  const [formCurrentValue, setFormCurrentValue] = React.useState('');
  const [formProposedValue, setFormProposedValue] = React.useState('');
  const [formEffectiveDate, setFormEffectiveDate] = React.useState('');
  const createMutation = useCreateAdHocMutation();

  const handleCreate = async () => {
    try {
      await createMutation.mutateAsync({
        employeeId: formEmployeeId,
        type: formType as AdHocType,
        reason: formReason,
        currentValue: parseFloat(formCurrentValue),
        proposedValue: parseFloat(formProposedValue),
        effectiveDate: new Date(formEffectiveDate).toISOString(),
      });
      toast({ title: 'Request created', description: 'Ad hoc request created as draft.' });
      setShowCreate(false);
      resetForm();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const resetForm = () => {
    setFormEmployeeId('');
    setFormType('SPOT_BONUS');
    setFormReason('');
    setFormCurrentValue('');
    setFormProposedValue('');
    setFormEffectiveDate('');
  };

  const handleAction = async (
    action: 'submit' | 'approve' | 'reject' | 'apply',
    item: AdHocIncrease,
  ) => {
    try {
      switch (action) {
        case 'submit':
          await submitMutation.mutateAsync(item.id);
          toast({ title: 'Submitted', description: 'Request submitted for approval.' });
          break;
        case 'approve':
          await approveMutation.mutateAsync(item.id);
          toast({ title: 'Approved', description: 'Request has been approved.' });
          break;
        case 'reject':
          setShowReject(item.id);
          return;
        case 'apply':
          await applyMutation.mutateAsync(item.id);
          toast({ title: 'Applied', description: 'Change applied to employee record.' });
          break;
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleRejectConfirm = async () => {
    if (!showReject) return;
    try {
      await rejectMutation.mutateAsync({ id: showReject, reason: rejectReason });
      toast({ title: 'Rejected', description: 'Request has been rejected.' });
      setShowReject(null);
      setRejectReason('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ad Hoc Changes</h1>
          <p className="text-muted-foreground">
            Manage off-cycle salary adjustments, bonuses, and promotions
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Request
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-8 w-20" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending Approval</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.pendingCount ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Approved This Month</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.approvedThisMonth ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Approved Amount</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(Number(stats?.totalApprovedAmount ?? 0))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">By Type</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.byType?.length ?? 0}</div>
                <p className="text-xs text-muted-foreground">active types</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="w-48">
          <Select
            options={STATUS_OPTIONS}
            placeholder="All Statuses"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-48">
          <Select
            options={TYPE_OPTIONS}
            placeholder="All Types"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Proposed</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No ad hoc requests found
                    </TableCell>
                  </TableRow>
                )}
                {listData?.data?.map((item) => {
                  const change = Number(item.proposedValue) - Number(item.currentValue);
                  const changePct =
                    Number(item.currentValue) > 0
                      ? ((change / Number(item.currentValue)) * 100).toFixed(1)
                      : 'N/A';
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.employee.firstName} {item.employee.lastName}
                        <div className="text-xs text-muted-foreground">
                          {item.employee.department} · {item.employee.level}
                        </div>
                      </TableCell>
                      <TableCell>{TYPE_LABELS[item.type] ?? item.type}</TableCell>
                      <TableCell>
                        {formatCurrency(Number(item.currentValue), item.currency)}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(Number(item.proposedValue), item.currency)}
                      </TableCell>
                      <TableCell>
                        <span className={change >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {change >= 0 ? '+' : ''}
                          {formatCurrency(change, item.currency)} ({changePct}%)
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[item.status]}>
                          {STATUS_LABELS[item.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(item.effectiveDate).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {item.status === 'DRAFT' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAction('submit', item)}
                            >
                              <Send className="h-3 w-3 mr-1" /> Submit
                            </Button>
                          )}
                          {item.status === 'PENDING_APPROVAL' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAction('approve', item)}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAction('reject', item)}
                              >
                                <XCircle className="h-3 w-3 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                          {item.status === 'APPROVED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAction('apply', item)}
                            >
                              <Zap className="h-3 w-3 mr-1" /> Apply
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {listData && listData.total > listData.limit && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="flex items-center text-sm text-muted-foreground">
            Page {page} of {Math.ceil(listData.total / listData.limit)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= Math.ceil(listData.total / listData.limit)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Ad Hoc Request</DialogTitle>
            <DialogDescription>Create an off-cycle compensation change request.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Employee ID</Label>
              <Input
                value={formEmployeeId}
                onChange={(e) => setFormEmployeeId(e.target.value)}
                placeholder="Employee ID"
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select
                options={TYPE_OPTIONS}
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
              />
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                placeholder="Justification for this change..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Current Value</Label>
                <Input
                  type="number"
                  value={formCurrentValue}
                  onChange={(e) => setFormCurrentValue(e.target.value)}
                />
              </div>
              <div>
                <Label>Proposed Value</Label>
                <Input
                  type="number"
                  value={formProposedValue}
                  onChange={(e) => setFormProposedValue(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={formEffectiveDate}
                onChange={(e) => setFormEffectiveDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                createMutation.isPending ||
                !formEmployeeId ||
                !formReason ||
                !formCurrentValue ||
                !formProposedValue ||
                !formEffectiveDate
              }
            >
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog
        open={!!showReject}
        onOpenChange={() => {
          setShowReject(null);
          setRejectReason('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this request.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Reason (optional)</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowReject(null);
                setRejectReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
