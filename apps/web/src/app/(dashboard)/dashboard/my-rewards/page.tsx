'use client';

import * as React from 'react';
import { FileDown, DollarSign, FileText, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';
import { useMyStatements, getStatementDownloadUrl } from '@/hooks/use-rewards-statements';

interface PersonalRewards {
  employee: {
    name: string;
    title: string;
    department: string;
    employeeId: string;
  };
  totalRewardsValue: number;
  breakdown: Array<{ category: string; value: number; previousValue: number }>;
  year: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function MyRewardsPage() {
  const [personal, setPersonal] = React.useState<PersonalRewards | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { data: statements, isLoading: statementsLoading } = useMyStatements();

  React.useEffect(() => {
    setLoading(true);
    apiClient
      .fetch<PersonalRewards>('/api/v1/analytics/total-rewards')
      .then(setPersonal)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Rewards</h1>
        <p className="text-muted-foreground">Your personal compensation and benefits summary.</p>
      </div>

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
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
        <>
          {/* Employee Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{personal.employee.name}</CardTitle>
              <CardDescription>
                {personal.employee.title} · {personal.employee.department}
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Total Value */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Rewards Value ({personal.year})</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <DollarSign className="h-6 w-6 text-green-600" />
                {formatCurrency(personal.totalRewardsValue)}
              </CardTitle>
            </CardHeader>
          </Card>

          {/* Breakdown */}
          {personal.breakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compensation Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {personal.breakdown.map((row) => (
                      <TableRow key={row.category}>
                        <TableCell className="font-medium">{row.category}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.value)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(personal.totalRewardsValue)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {personal.breakdown.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <DollarSign className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">
                  No compensation data linked to your account
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Downloadable Statements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            My Statements
          </CardTitle>
          <CardDescription>Download your total rewards PDF statements.</CardDescription>
        </CardHeader>
        <CardContent>
          {statementsLoading && <Skeleton className="h-20 w-full" />}

          {statements && statements.length > 0 && (
            <div className="space-y-2">
              {statements.map((stmt) => (
                <div
                  key={stmt.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">Total Rewards Statement — {stmt.year}</p>
                    <p className="text-xs text-muted-foreground">
                      Generated {new Date(stmt.generatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{stmt.status}</Badge>
                    {stmt.pdfUrl && (
                      <a
                        href={getStatementDownloadUrl(stmt.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
                      >
                        <FileDown className="mr-1 h-4 w-4" />
                        Download
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {statements && statements.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No statements available yet. Your HR team will generate them.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
