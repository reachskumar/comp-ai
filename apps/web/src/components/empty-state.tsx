"use client";

import { type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground text-center max-w-sm">
          {description}
        </p>
        {actionLabel && (actionHref || onAction) && (
          actionHref ? (
            <a href={actionHref}>
              <Button className="mt-4">{actionLabel}</Button>
            </a>
          ) : (
            <Button className="mt-4" onClick={onAction}>
              {actionLabel}
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}

