"use client";

import { ExternalLink, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CompportManagedStateProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

export function CompportManagedState({
  title,
  description,
  icon: Icon,
}: CompportManagedStateProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        <Badge variant="secondary" className="text-xs">Managed in Compport</Badge>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Managed in Compport</h2>
          <p className="mt-1 text-sm text-muted-foreground text-center max-w-md">
            This module is managed through the Compport platform.
            Access it from your Compport dashboard for full functionality.
          </p>
          <a href="https://app.compport.com" target="_blank" rel="noopener noreferrer">
            <Button className="mt-4" variant="outline">
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
              Open in Compport
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

