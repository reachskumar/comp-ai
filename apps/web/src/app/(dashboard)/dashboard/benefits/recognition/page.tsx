"use client";

import { useState } from "react";
import { Award, Trophy, Star, Gift, BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function RecognitionRewardsPage() {
  const [tab, setTab] = useState("programs");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recognition &amp; Rewards</h1>
          <p className="text-muted-foreground">
            Celebrate achievements and manage employee reward programs.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="programs">Programs</TabsTrigger>
          <TabsTrigger value="nominations">Nominations</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="rewards">Rewards Catalog</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="programs" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Spot Awards", desc: "Instant recognition for outstanding work", icon: Star },
              { title: "Peer Recognition", desc: "Employee-to-employee appreciation", icon: Trophy },
              { title: "Service Awards", desc: "Milestone and tenure celebrations", icon: Award },
            ].map((program) => (
              <Card key={program.title}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <program.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{program.title}</CardTitle>
                      <CardDescription className="text-xs">{program.desc}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Program configuration and budget allocation will be managed here.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="nominations">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Star className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Nominations</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Submit and review nominations for awards and recognition programs.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leaderboard">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Trophy className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Recognition Leaderboard</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                View top recognized employees and departments across the organization.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rewards">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Gift className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Rewards Catalog</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Browse and manage available rewards including gift cards, experiences, and merchandise.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <BarChart3 className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Recognition Analytics</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Track program participation, budget utilization, and engagement trends.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

