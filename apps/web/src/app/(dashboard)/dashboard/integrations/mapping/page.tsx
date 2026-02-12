"use client";

import { Map, ArrowRightLeft, Database, FileText, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "Field Mapper",
    description: "Map source system fields to Compport data model with drag-and-drop interface.",
    icon: ArrowRightLeft,
  },
  {
    title: "Data Transformations",
    description: "Apply transformations, lookups, and formatting rules during data mapping.",
    icon: Database,
  },
  {
    title: "Mapping Templates",
    description: "Save and reuse mapping configurations across similar integrations.",
    icon: FileText,
  },
  {
    title: "Validation Rules",
    description: "Define validation rules to ensure data quality during field mapping.",
    icon: Settings,
  },
];

export default function FieldMappingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Field Mapping</h1>
          <p className="text-muted-foreground">
            Configure how data fields map between connected systems.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <Map className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Field Mapping Studio</CardTitle>
              <CardDescription>
                Visual field mapping tool for configuring data flows between systems.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {features.map((feature) => (
          <Card key={feature.title}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <feature.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <CardTitle className="text-base">{feature.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

