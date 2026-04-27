'use client';

import { useState, useEffect, useCallback } from 'react';
import { Building2, Users, Briefcase, Calendar, Crown, FileSignature, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  _count: { users: number; employees: number };
}

interface LetterSignature {
  name: string;
  title: string;
}

function readLetterSignature(settings: Record<string, unknown> | null): LetterSignature {
  if (!settings || typeof settings !== 'object') return { name: '', title: '' };
  const sig = (settings as Record<string, unknown>)['letterSignature'];
  if (!sig || typeof sig !== 'object') return { name: '', title: '' };
  const s = sig as Record<string, unknown>;
  return {
    name: typeof s['name'] === 'string' ? s['name'] : '',
    title: typeof s['title'] === 'string' ? s['title'] : '',
  };
}

export default function TenantSettingsPage() {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { toast } = useToast();

  const [sigName, setSigName] = useState('');
  const [sigTitle, setSigTitle] = useState('');
  const [sigSaving, setSigSaving] = useState(false);

  const fetchTenant = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiClient.getTenantInfo();
      setTenant(data);
      const sig = readLetterSignature(data?.settings ?? null);
      setSigName(sig.name);
      setSigTitle(sig.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTenant();
  }, [fetchTenant]);

  const planLabel = tenant?.plan
    ? tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1)
    : 'Free';

  const currentSig = readLetterSignature(tenant?.settings ?? null);
  const sigDirty = sigName !== currentSig.name || sigTitle !== currentSig.title;

  const saveSignature = async () => {
    setSigSaving(true);
    try {
      await apiClient.updateLetterSignature({ name: sigName, title: sigTitle });
      toast({
        title: 'Letter signature saved',
        description: 'New letters will use this signature.',
      });
      await fetchTenant();
    } catch (err) {
      toast({
        title: "Couldn't save signature",
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSigSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tenant Settings</h1>
        <p className="text-muted-foreground">View your organization settings and details.</p>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((k) => (
            <Card key={k}>
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-6 w-48" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : tenant ? (
        <>
          {/* Organization Info */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>{tenant.name}</CardTitle>
                  <CardDescription>Organization ID: {tenant.id}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Slug</p>
                  <p className="text-sm font-medium font-mono">{tenant.slug}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Plan</p>
                  <div className="flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-500" />
                    <Badge variant="secondary">{planLabel}</Badge>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="text-sm font-medium">
                    {new Date(tenant.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Last Updated</p>
                  <p className="text-sm font-medium">
                    {new Date(tenant.updatedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Users
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tenant._count.users}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Employees
                </CardTitle>
                <Briefcase className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tenant._count.employees}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Current User
                </CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-sm font-bold">{user?.email ?? '—'}</div>
                <p className="text-xs text-muted-foreground mt-1">Role: {user?.role ?? '—'}</p>
              </CardContent>
            </Card>
          </div>

          {/* Letter Signature */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <FileSignature className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Letter Signature</CardTitle>
                  <CardDescription>
                    Signs every compensation letter your team generates. Leave blank to fall back to{' '}
                    <span className="font-medium">
                      {tenant.name} HR Team · People &amp; Compensation
                    </span>
                    .
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sig-name">Signer name</Label>
                  <Input
                    id="sig-name"
                    placeholder="e.g. Sachin Bajaj"
                    value={sigName}
                    maxLength={120}
                    onChange={(e) => setSigName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sig-title">Title</Label>
                  <Input
                    id="sig-title"
                    placeholder="e.g. Founder & CEO"
                    value={sigTitle}
                    maxLength={120}
                    onChange={(e) => setSigTitle(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                {sigDirty && !sigSaving && (
                  <span className="text-xs text-muted-foreground">Unsaved changes</span>
                )}
                <Button
                  onClick={() => void saveSignature()}
                  disabled={!sigDirty || sigSaving}
                  size="sm"
                >
                  {sigSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save signature'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
