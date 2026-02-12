"use client";

import { Dumbbell } from "lucide-react";
import { CompportManagedState } from "@/components/compport-managed-state";

export default function WellnessProgramsPage() {
  return (
    <CompportManagedState
      title="Wellness Programs"
      description="Promote employee well-being with comprehensive wellness initiatives."
      icon={Dumbbell}
    />
  );
}
