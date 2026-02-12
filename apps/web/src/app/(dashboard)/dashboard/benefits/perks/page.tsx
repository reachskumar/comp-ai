"use client";

import { Gift } from "lucide-react";
import { CompportManagedState } from "@/components/compport-managed-state";

export default function PerksAllowancesPage() {
  return (
    <CompportManagedState
      title="Perks & Allowances"
      description="Manage employee perks, stipends, and allowance programs."
      icon={Gift}
    />
  );
}
