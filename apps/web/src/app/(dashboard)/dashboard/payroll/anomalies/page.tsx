"use client";

import { AlertTriangle } from "lucide-react";
import { PlaceholderPage } from "@/components/placeholder-page";

export default function AnomaliesPage() {
  return (
    <PlaceholderPage
      title="Anomalies"
      description="Review detected payroll anomalies and discrepancies."
      icon={AlertTriangle}
    />
  );
}

