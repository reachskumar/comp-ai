"use client";

import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="mt-6 text-xl font-semibold">Page not found</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link href="/dashboard" className={buttonVariants({ className: "mt-6" })}>
        Go to Dashboard
      </Link>
    </div>
  );
}

