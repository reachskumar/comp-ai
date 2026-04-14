'use client';

import * as React from 'react';
import { Database, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface CompportDataTableProps {
  title: string;
  description?: string;
  data: Record<string, unknown>[] | undefined;
  isLoading: boolean;
  error?: Error | null;
  /** Columns to display. If not provided, auto-detects from data. */
  columns?: { key: string; label: string; format?: (v: unknown) => string }[];
  /** Max columns to auto-detect (default: 8) */
  maxAutoColumns?: number;
  pageSize?: number;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) > 9999) {
      return new Intl.NumberFormat('en-IN').format(v);
    }
    if (!Number.isInteger(v)) {
      return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v);
    }
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  // Detect ISO dates
  if (/^\d{4}-\d{2}-\d{2}(T|\s)/.test(s)) {
    try {
      return new Date(s).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return s;
    }
  }
  // Truncate long strings
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

function humanizeColumnName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CompportDataTable({
  title,
  description,
  data,
  isLoading,
  error,
  columns,
  maxAutoColumns = 8,
  pageSize = 10,
}: CompportDataTableProps) {
  const [page, setPage] = React.useState(0);

  const rows = data ?? [];
  const totalPages = Math.ceil(rows.length / pageSize);
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  // Auto-detect columns from first row if not provided
  const displayColumns = React.useMemo(() => {
    if (columns) return columns;
    if (rows.length === 0) return [];
    const keys = Object.keys(rows[0] as Record<string, unknown>);
    return keys.slice(0, maxAutoColumns).map((key) => ({
      key,
      label: humanizeColumnName(key),
    }));
  }, [columns, rows, maxAutoColumns]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{title}</CardTitle>
            {rows.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {rows.length} rows
              </Badge>
            )}
          </div>
        </div>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-destructive">
            {error.message}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No data available from Compport for this tenant.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {displayColumns.map((col) => (
                      <TableHead key={col.key} className="text-xs whitespace-nowrap">
                        {col.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row, i) => (
                    <TableRow key={i}>
                      {displayColumns.map((col) => (
                        <TableCell key={col.key} className="text-xs whitespace-nowrap">
                          {col.format
                            ? col.format((row as Record<string, unknown>)[col.key])
                            : formatValue((row as Record<string, unknown>)[col.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-2">
                <p className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
