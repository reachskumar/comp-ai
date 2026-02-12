"use client";

import { Dumbbell, Heart, Brain, Apple, Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "Fitness Programs",
    description: "Gym memberships, fitness challenges, and activity tracking integrations.",
    icon: Activity,
  },
  {
    title: "Mental Health",
    description: "EAP access, counseling benefits, and mindfulness program management.",
    icon: Brain,
  },
  {
    title: "Preventive Care",
    description: "Health screenings, biometric tracking, and vaccination programs.",
    icon: Heart,
  },
  {
    title: "Nutrition & Wellness",
    description: "Nutrition counseling, wellness stipends, and healthy living incentives.",
    icon: Apple,
  },
];

export default function WellnessProgramsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wellness Programs</h1>
          <p className="text-muted-foreground">
            Promote employee well-being with comprehensive wellness initiatives.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <Dumbbell className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Wellness Hub</CardTitle>
              <CardDescription>
                Design and manage holistic wellness programs that support physical and mental health.
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

