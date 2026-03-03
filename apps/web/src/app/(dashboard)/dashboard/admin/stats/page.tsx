'use client';

import { Building2, Users, Briefcase, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminStats } from '@/hooks/use-admin';

export default function AdminStatsPage() {
  const { data: stats, isLoading } = useAdminStats();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Platform Statistics</h1>
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((k) => (
            <Skeleton key={k} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Tenants',
      value: stats?.totalTenants ?? 0,
      icon: Building2,
      color: 'text-blue-600',
    },
    {
      label: 'Active Tenants',
      value: stats?.activeTenants ?? 0,
      icon: Building2,
      color: 'text-green-600',
    },
    { label: 'Total Users', value: stats?.totalUsers ?? 0, icon: Users, color: 'text-purple-600' },
    {
      label: 'Total Employees',
      value: stats?.totalEmployees ?? 0,
      icon: Briefcase,
      color: 'text-orange-600',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Statistics</h1>
        <p className="text-sm text-muted-foreground">
          Overview of all tenants and users across the platform
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className={`h-4 w-4 ${color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats && (stats as any).planBreakdown && (
        <Card>
          <CardHeader>
            <CardTitle>Tenants by Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              {Object.entries((stats as any).planBreakdown as Record<string, number>).map(
                ([plan, count]) => (
                  <div key={plan} className="text-center p-4 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{count as number}</p>
                    <p className="text-sm text-muted-foreground capitalize">{plan}</p>
                  </div>
                ),
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {stats && (stats as any).recentTenants?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Tenants</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {((stats as any).recentTenants as any[]).map((t: any) => (
              <div
                key={t.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.slug}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(t.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
