'use client';

import { useEffect } from 'react';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function TenantDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[TenantDetailError]', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="mt-6 text-xl font-semibold">Failed to load tenant</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Something went wrong while loading tenant details. This is usually temporary — please try
        again.
      </p>
      {error.digest && (
        <p className="mt-1 text-xs text-muted-foreground">Error ID: {error.digest}</p>
      )}
      <div className="mt-6 flex gap-3">
        <Link href="/dashboard/admin/customers">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Customers
          </Button>
        </Link>
        <Button onClick={reset}>Try Again</Button>
      </div>
    </div>
  );
}
