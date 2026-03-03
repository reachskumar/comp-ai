'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export default function SuspendedPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <CardTitle className="text-2xl">Account Suspended</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">
            Your organization&apos;s account has been temporarily suspended. Please contact your
            administrator or support for assistance.
          </p>
          <p className="text-sm text-muted-foreground">
            If you believe this is an error, please reach out to{' '}
            <a href="mailto:support@compportiq.ai" className="text-primary underline">
              support@compportiq.ai
            </a>
          </p>
          <Link href="/login">
            <Button variant="outline">Back to Login</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
