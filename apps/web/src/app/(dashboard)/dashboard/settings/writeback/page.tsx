'use client';

import Link from 'next/link';
import { DatabaseBackup, Eye } from 'lucide-react';
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
import {
  useBatchList,
  type WriteBackBatch,
  type WriteBackBatchStatus,
} from '@/hooks/use-writeback';

const STATUS_STYLES: Record<WriteBackBatchStatus, { label: string; className: string }> = {
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

function StatusBadge({ status }: { status: WriteBackBatchStatus }) {
  const style = STATUS_STYLES[status] ?? { label: status, className: '' };
  return <Badge className={style.className}>{style.label}</Badge>;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function WriteBackPage() {
  const { data: batches, isLoading, error } = useBatchList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <DatabaseBackup className="h-6 w-6 text-primary" />
          Write-Back Queue
        </h1>
        <p className="text-muted-foreground mt-1">
          Review and apply approved compensation changes to Compport Cloud SQL.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Batches</CardTitle>
          <CardDescription>
            Each batch contains approved recommendations ready for write-back.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              Failed to load batches: {error.message}
            </div>
          ) : !batches || batches.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <DatabaseBackup className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No write-back batches yet</p>
              <p className="text-sm mt-1">
                Batches are created when compensation recommendations are approved in a comp cycle.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead className="text-right">Applied</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Applied By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch: WriteBackBatch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-mono text-xs">{shortId(batch.id)}</TableCell>
                    <TableCell>
                      <StatusBadge status={batch.status} />
                    </TableCell>
                    <TableCell className="text-right">{batch.totalRecords}</TableCell>
                    <TableCell className="text-right">{batch.appliedRecords}</TableCell>
                    <TableCell className="text-right">{batch.failedRecords}</TableCell>
                    <TableCell className="text-sm">{formatDate(batch.createdAt)}</TableCell>
                    <TableCell className="text-sm">{batch.appliedBy ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/dashboard/settings/writeback/${batch.id}`}>
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4 mr-1" /> View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
