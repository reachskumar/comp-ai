"use client";

import { SlidersHorizontal } from "lucide-react";
import { CompportManagedState } from "@/components/compport-managed-state";

export default function FlexibleBenefitsPage() {
  return (
    <CompportManagedState
      title="Flexible Benefits"
      description="Manage FSA, HSA, and lifestyle spending accounts for employees."
      icon={SlidersHorizontal}
    />
  );
}
