"use client";

import { Award } from "lucide-react";
import { CompportManagedState } from "@/components/compport-managed-state";

export default function RecognitionRewardsPage() {
  return (
    <CompportManagedState
      title="Recognition & Rewards"
      description="Celebrate achievements and manage employee reward programs."
      icon={Award}
    />
  );
}
