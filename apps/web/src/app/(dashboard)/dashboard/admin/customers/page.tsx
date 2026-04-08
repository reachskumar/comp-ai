'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Building2, Search, Plus, Users, Briefcase, ChevronLeft, ChevronRight,
  Shield, RefreshCw, CheckCircle2, XCircle, Clock, Layers,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminTenants, useAdminStats } from '@/hooks/use-admin';

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4 text-center">
        <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function formatDate(d: string | null) {
  if (!d) return 'Never';
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}

export default function AdminCustomersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useAdminTenants({ page, limit: 20, search: search || undefined });
  const { data: stats } = useAdminStats();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">Manage all tenant organizations on the platform.</p>
        </div>
        <Link href="/dashboard/admin/onboarding">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Onboard Customer
          </Button>
        </Link>
      </div>

      {/* Platform Summary Cards */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard icon={Building2} label="Total Tenants" value={stats.totalTenants} />
          <StatCard icon={CheckCircle2} label="Active" value={stats.activeTenants} />
          <StatCard icon={XCircle} label="Suspended" value={stats.suspendedTenants} />
          <StatCard icon={Users} label="Total Users" value={stats.totalUsers} />
          <StatCard icon={Briefcase} label="Total Employees" value={stats.totalEmployees} />
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or slug..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to load tenants'}
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((k) => (
            <Skeleton key={k} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {data?.data.map((tenant: any) => (
              <Link key={tenant.id} href={`/dashboard/admin/customers/${tenant.id}`}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{tenant.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {tenant.subdomain ? `${tenant.subdomain}.compportiq.ai` : tenant.slug}
                            {tenant.compportSchema && (
                              <span className="ml-2 font-mono text-xs opacity-60">
                                [{tenant.compportSchema}]
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={tenant.isActive ? 'default' : 'destructive'}>
                          {tenant.isActive ? 'Active' : 'Suspended'}
                        </Badge>
                        <Badge variant="outline">{tenant.plan}</Badge>
                      </div>
                    </div>
                    {/* Metrics row */}
                    <div className="mt-3 flex items-center gap-6 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {tenant._count.users} users
                      </span>
                      <span className="flex items-center gap-1">
                        <Briefcase className="h-3 w-3" /> {tenant._count.employees} employees
                      </span>
                      <span className="flex items-center gap-1">
                        <Shield className="h-3 w-3" /> {tenant._count.tenantRoles ?? 0} roles
                      </span>
                      <span className="flex items-center gap-1">
                        <Layers className="h-3 w-3" /> {tenant._count.ruleSets ?? 0} rule sets
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {tenant._count.compCycles ?? 0} cycles
                      </span>
                      {tenant.syncStatus?.connected ? (
                        <span className="flex items-center gap-1">
                          <RefreshCw className="h-3 w-3 text-green-600" />
                          Synced {formatDate(tenant.syncStatus.lastSyncAt)}
                          {tenant.syncStatus.lastJobRecords > 0 && (
                            <span>({tenant.syncStatus.lastJobRecords} records)</span>
                          )}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-600">
                          <XCircle className="h-3 w-3" /> Not connected
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {data?.data.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No customers found.
                </CardContent>
              </Card>
            )}
          </div>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {data.page} of {data.totalPages} ({data.total} total)
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
