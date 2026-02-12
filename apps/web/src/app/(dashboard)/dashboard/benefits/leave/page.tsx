"use client";

import { CalendarDays } from "lucide-react";
import { CompportManagedState } from "@/components/compport-managed-state";

export default function LeaveManagementPage() {
  return (
    <CompportManagedState
      title="Leave Management"
      description="Track and manage employee leave balances, requests, and policies."
      icon={CalendarDays}
    />
  );
}
