"use client";

import { Landmark } from "lucide-react";
import { CompportManagedState } from "@/components/compport-managed-state";

export default function RetirementPlansPage() {
  return (
    <CompportManagedState
      title="Retirement Plans"
      description="Manage 401(k), pension, and other retirement benefit programs."
      icon={Landmark}
    />
  );
}
