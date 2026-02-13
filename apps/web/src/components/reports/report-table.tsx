"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReportColumn } from "@/hooks/use-reports";

interface ReportTableProps {
  data: Record<string, unknown>[];
  columns?: ReportColumn[];
}

export function ReportTable({ data, columns }: ReportTableProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No data to display
      </div>
    );
  }

  // Auto-derive columns from data keys if not provided
  const displayColumns: ReportColumn[] =
    columns && columns.length > 0
      ? columns
      : Object.keys(data[0] ?? {}).map((key) => ({
          key,
          label: key
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (s) => s.toUpperCase())
            .trim(),
        }));

  const formatValue = (value: unknown): string => {
    if (value == null) return "—";
    if (typeof value === "number") {
      return value % 1 === 0
        ? value.toLocaleString()
        : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (value instanceof Date) return value.toLocaleDateString();
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  return (
    <ScrollArea className="max-h-[400px]">
      <Table>
        <TableHeader>
          <TableRow>
            {displayColumns.map((col) => (
              <TableHead key={col.key} className="whitespace-nowrap">
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.slice(0, 100).map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {displayColumns.map((col) => (
                <TableCell key={col.key} className="whitespace-nowrap">
                  {formatValue(row[col.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.length > 100 && (
        <p className="py-2 text-center text-xs text-muted-foreground">
          Showing 100 of {data.length} rows
        </p>
      )}
    </ScrollArea>
  );
}

