'use client';

import { useState } from 'react';
import { Database, ChevronLeft, ChevronRight, Table as TableIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMyDataTables, useMyDataQuery } from '@/hooks/use-admin';

const PAGE_SIZE = 50;

export default function TenantDataExplorerPage() {
  const [selectedTable, setSelectedTable] = useState('');
  const [offset, setOffset] = useState(0);

  const { data: tablesData, isLoading: tablesLoading, error: tablesError } = useMyDataTables();
  const { data: queryData, isLoading: queryLoading } = useMyDataQuery(selectedTable || null, {
    limit: PAGE_SIZE,
    offset,
  });

  const columns = queryData?.rows?.[0] ? Object.keys(queryData.rows[0]) : [];
  const totalCount = queryData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Data Explorer</h1>
        <p className="text-muted-foreground">
          Browse your organization&apos;s Compport data in real time.
        </p>
      </div>

      {tablesError && (
        <Card className="border-destructive">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">
              {tablesError instanceof Error
                ? tablesError.message
                : 'Failed to load tables. Your tenant may not have Compport data linked yet.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Table selector */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-72">
          <label className="mb-1 block text-sm font-medium">Table</label>
          {tablesLoading ? (
            <Skeleton className="h-9 w-full rounded-md" />
          ) : (
            <Select
              placeholder="Select a table..."
              options={(tablesData?.tables ?? []).map((t: string) => ({ value: t, label: t }))}
              value={selectedTable}
              onChange={(e) => {
                setSelectedTable(e.target.value);
                setOffset(0);
              }}
            />
          )}
        </div>

        {selectedTable && !queryLoading && (
          <Badge variant="outline" className="mb-0.5">
            <TableIcon className="mr-1 h-3 w-3" />
            {totalCount.toLocaleString()} rows
          </Badge>
        )}
      </div>

      {/* Data Table */}
      {!selectedTable ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Database className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Select a table to start exploring</p>
            <p className="text-sm text-muted-foreground">
              Pick a table above to browse your Compport data.
            </p>
          </CardContent>
        </Card>
      ) : queryLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((k) => (
            <Skeleton key={k} className="h-10 w-full rounded" />
          ))}
        </div>
      ) : queryData?.rows && queryData.rows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead key={col} className="whitespace-nowrap">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queryData.rows.map((row, i) => (
                    <TableRow key={i}>
                      {columns.map((col) => (
                        <TableCell key={col} className="whitespace-nowrap max-w-[300px] truncate">
                          {row[col] == null ? (
                            <span className="text-muted-foreground italic">null</span>
                          ) : (
                            String(row[col])
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No data in this table.
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages} ({totalCount.toLocaleString()} total rows)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
