'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Play,
  Eye,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Copy,
  DatabaseBackup,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useBatchDetail,
  usePreviewMutation,
  useDryRunMutation,
  useApplyMutation,
  type WriteBackRecord,
  type WriteBackRecordStatus,
  type WriteBackBatchStatus,
  type PreviewResult,
  type DryRunResult,
} from '@/hooks/use-writeback';

// ─── Helpers ───────────────────────────────────────────────

const RECORD_STATUS_STYLES: Record<WriteBackRecordStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'bg-gray-100 text-gray-700 border-gray-200' },
  VALIDATED: { label: 'Validated', className: 'bg-green-100 text-green-800 border-green-200' },
  VALIDATION_FAILED: { label: 'Invalid', className: 'bg-red-100 text-red-800 border-red-200' },
  APPLIED: { label: 'Applied', className: 'bg-green-200 text-green-900 border-green-300' },
  FAILED: { label: 'Failed', className: 'bg-red-200 text-red-900 border-red-300' },
  SKIPPED: { label: 'Skipped', className: 'bg-gray-200 text-gray-600 border-gray-300' },
};

const BATCH_STATUS_STYLES: Record<WriteBackBatchStatus, { label: string; className: string }> = {
  PENDING_REVIEW: {
    label: 'Pending Review',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  },
  PREVIEWED: { label: 'Previewed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  DRY_RUN_OK: { label: 'Dry Run OK', className: 'bg-green-100 text-green-800 border-green-200' },
  DRY_RUN_FAILED: { label: 'Dry Run Failed', className: 'bg-red-100 text-red-800 border-red-200' },
  APPLYING: { label: 'Applying…', className: 'bg-purple-100 text-purple-800 border-purple-200' },
  APPLIED: { label: 'Applied', className: 'bg-green-200 text-green-900 border-green-300' },
  PARTIALLY_APPLIED: {
    label: 'Partial',
    className: 'bg-orange-100 text-orange-800 border-orange-200',
  },
  FAILED: { label: 'Failed', className: 'bg-red-200 text-red-900 border-red-300' },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortId(id: string) {
  return id.slice(0, 8);
}

// ─── Main Page ─────────────────────────────────────────────

export default function BatchDetailPage() {
  const params = useParams();
  const batchId = params.batchId as string;

  const { data: batch, isLoading, error } = useBatchDetail(batchId);
  const previewMutation = usePreviewMutation();
  const dryRunMutation = useDryRunMutation();
  const applyMutation = useApplyMutation();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [dryRunData, setDryRunData] = useState<DryRunResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showApply, setShowApply] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [activeTab, setActiveTab] = useState('records');

  const records = batch?.records ?? [];
  const allSelected = records.length > 0 && selectedIds.size === records.length;

  // Can only apply if dry-run passed (or previewed in some workflows)
  const canApply = batch && ['DRY_RUN_OK', 'PREVIEWED'].includes(batch.status);
  const isCompleted = batch && ['APPLIED', 'PARTIALLY_APPLIED', 'FAILED'].includes(batch.status);

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(records.map((r) => r.id)));
    }
  }

  function toggleRecord(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function handlePreview() {
    const result = await previewMutation.mutateAsync(batchId);
    setPreviewData(result);
    setShowPreview(true);
  }

  async function handleDryRun() {
    const result = await dryRunMutation.mutateAsync(batchId);
    setDryRunData(result);
  }

  async function handleApply() {
    if (confirmText !== 'APPLY') return;
    await applyMutation.mutateAsync({
      batchId,
      confirmPhrase: 'APPLY',
      selectedRecordIds: selectedIds.size > 0 ? Array.from(selectedIds) : undefined,
    });
    setShowApply(false);
    setConfirmText('');
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !batch) {
    return (
      <div className="text-center py-12 text-destructive">
        <p>Failed to load batch: {error?.message ?? 'Not found'}</p>
        <Link href="/dashboard/settings/writeback">
          <Button variant="ghost" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
      </div>
    );
  }

  const batchStyle = BATCH_STATUS_STYLES[batch.status];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings/writeback">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              Batch {shortId(batch.id)}
              <Badge className={batchStyle.className}>{batchStyle.label}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Created {formatDate(batch.createdAt)}
              {batch.appliedAt && ` · Applied ${formatDate(batch.appliedAt)}`}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        {!isCompleted && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={previewMutation.isPending}
            >
              {previewMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Eye className="h-4 w-4 mr-1" />
              )}
              Preview SQL
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDryRun}
              disabled={dryRunMutation.isPending}
            >
              {dryRunMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Dry Run
            </Button>
            {canApply && (
              <Button
                size="sm"
                onClick={() => setShowApply(true)}
                className="bg-primary text-primary-foreground"
              >
                <DatabaseBackup className="h-4 w-4 mr-1" />
                Apply to Cloud SQL
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-sm text-muted-foreground">Total Records</p>
            <p className="text-2xl font-bold">{batch.totalRecords}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-sm text-muted-foreground">Applied</p>
            <p className="text-2xl font-bold text-green-600">{batch.appliedRecords}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-sm text-muted-foreground">Failed</p>
            <p className="text-2xl font-bold text-red-600">{batch.failedRecords}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-sm text-muted-foreground">Selected</p>
            <p className="text-2xl font-bold">{selectedIds.size || 'All'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Records / Dry Run / History */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="dryrun" disabled={!dryRunData}>
            Dry Run Results
          </TabsTrigger>
          {isCompleted && <TabsTrigger value="history">History</TabsTrigger>}
        </TabsList>

        {/* Records Tab */}
        <TabsContent value="records">
          <Card>
            <CardContent className="pt-4">
              {records.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No records in this batch.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {!isCompleted && (
                        <TableHead className="w-10">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            className="rounded border-gray-300"
                          />
                        </TableHead>
                      )}
                      <TableHead>Employee</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Previous</TableHead>
                      <TableHead>New Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((rec: WriteBackRecord) => {
                      const style = RECORD_STATUS_STYLES[rec.status];
                      return (
                        <TableRow key={rec.id}>
                          {!isCompleted && (
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(rec.id)}
                                onChange={() => toggleRecord(rec.id)}
                                className="rounded border-gray-300"
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-xs">
                            {shortId(rec.employeeId)}
                          </TableCell>
                          <TableCell>{rec.fieldName}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {rec.previousValue}
                          </TableCell>
                          <TableCell className="font-medium">{rec.newValue}</TableCell>
                          <TableCell>
                            <Badge className={style.className}>{style.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-red-600">
                            {rec.errorMessage ?? ''}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dry Run Results Tab */}
        <TabsContent value="dryrun">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {dryRunData?.success ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-600" /> All Records Valid
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-5 w-5 text-yellow-600" /> Validation Issues Found
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dryRunData && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dryRunData.results.map((r) => (
                      <TableRow key={r.recordId}>
                        <TableCell className="font-mono text-xs">{shortId(r.employeeId)}</TableCell>
                        <TableCell>{r.fieldName}</TableCell>
                        <TableCell>
                          {r.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-red-600">{r.error ?? ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab (completed batches) */}
        {isCompleted && (
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Audit Trail</CardTitle>
                <CardDescription>
                  Applied by {batch.appliedBy ?? '—'}
                  {batch.appliedAt && ` on ${formatDate(batch.appliedAt)}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-muted-foreground">Idempotency Key</p>
                    <p className="font-mono text-xs mt-1">{batch.idempotencyKey}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">Connector</p>
                    <p className="font-mono text-xs mt-1">{shortId(batch.connectorId)}</p>
                  </div>
                </div>

                {batch.rollbackSql && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-muted-foreground">Rollback SQL</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(batch.rollbackSql!)}
                      >
                        <Copy className="h-3 w-3 mr-1" /> Copy
                      </Button>
                    </div>
                    <pre className="bg-muted rounded-md p-4 text-xs overflow-x-auto whitespace-pre-wrap max-h-64">
                      {batch.rollbackSql}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* SQL Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent
          className="max-w-2xl max-h-[80vh] overflow-auto"
          onClose={() => setShowPreview(false)}
        >
          <DialogHeader>
            <DialogTitle>SQL Preview</DialogTitle>
            <DialogDescription>
              Parameterized queries that will be executed. No data has been written.
            </DialogDescription>
          </DialogHeader>
          {previewData && (
            <div className="space-y-3">
              {previewData.statements.map((stmt) => (
                <div key={stmt.recordId} className="border rounded-md p-3">
                  <p className="text-xs text-muted-foreground mb-1">
                    Record {shortId(stmt.recordId)}
                  </p>
                  <pre className="text-xs bg-muted rounded p-2 whitespace-pre-wrap">{stmt.sql}</pre>
                  {stmt.params.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Params: {JSON.stringify(stmt.params)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Confirmation Dialog */}
      <Dialog open={showApply} onOpenChange={setShowApply}>
        <DialogContent onClose={() => setShowApply(false)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirm Write-Back
            </DialogTitle>
            <DialogDescription>
              This will apply {selectedIds.size > 0 ? selectedIds.size : batch.totalRecords}{' '}
              record(s) to Compport Cloud SQL. This action cannot be automatically undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="confirm-apply">
              Type <span className="font-mono font-bold">APPLY</span> to confirm:
            </Label>
            <Input
              id="confirm-apply"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="APPLY"
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowApply(false);
                setConfirmText('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              disabled={confirmText !== 'APPLY' || applyMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {applyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Applying…
                </>
              ) : (
                'Apply to Cloud SQL'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
