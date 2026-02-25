"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RulesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[RulesError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="mt-6 text-xl font-semibold">Rules Engine unavailable</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Something went wrong loading the rules engine. Please try again.
      </p>
      <Button onClick={reset} className="mt-6">
        Try Again
      </Button>
    </div>
  );
}

