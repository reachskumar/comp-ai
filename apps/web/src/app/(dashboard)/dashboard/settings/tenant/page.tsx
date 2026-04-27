'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Users,
  Briefcase,
  Calendar,
  Crown,
  FileSignature,
  Loader2,
  GitBranch,
  Plus,
  Trash2,
  ArrowDown,
} from 'lucide-react';
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

interface ApprovalChainStep {
  role: string;
  label: string;
}

function readApprovalChain(settings: Record<string, unknown> | null): ApprovalChainStep[] {
  if (!settings || typeof settings !== 'object') return [];
  const raw = (settings as Record<string, unknown>)['letterApprovalChain'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is { role: string; label: string } =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as { role?: unknown }).role === 'string' &&
        typeof (s as { label?: unknown }).label === 'string',
    )
    .map((s) => ({ role: s.role, label: s.label }));
}

function chainsEqual(a: ApprovalChainStep[], b: ApprovalChainStep[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.role === b[i]!.role && s.label === b[i]!.label);
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

  const [chain, setChain] = useState<ApprovalChainStep[]>([]);
  const [chainSaving, setChainSaving] = useState(false);

  const fetchTenant = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiClient.getTenantInfo();
      setTenant(data);
      const sig = readLetterSignature(data?.settings ?? null);
      setSigName(sig.name);
      setSigTitle(sig.title);
      setChain(readApprovalChain(data?.settings ?? null));
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

  const persistedChain = readApprovalChain(tenant?.settings ?? null);
  const chainDirty = !chainsEqual(chain, persistedChain);
  const chainHasEmptyRow = chain.some((s) => !s.role.trim() || !s.label.trim());

  const updateChainStep = (idx: number, patch: Partial<ApprovalChainStep>) =>
    setChain((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const addChainStep = () => setChain((prev) => [...prev, { role: '', label: '' }]);
  const removeChainStep = (idx: number) => setChain((prev) => prev.filter((_, i) => i !== idx));
  const moveChainStep = (idx: number, dir: -1 | 1) =>
    setChain((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });

  const saveChain = async () => {
    setChainSaving(true);
    try {
      await apiClient.updateLetterApprovalChain({ chain });
      toast({
        title: chain.length === 0 ? 'Approval chain cleared' : 'Approval chain saved',
        description:
          chain.length === 0
            ? 'New letters will be approved in a single step.'
            : `Letters will route through ${chain.length} step${chain.length === 1 ? '' : 's'}.`,
      });
      await fetchTenant();
    } catch (err) {
      toast({
        title: "Couldn't save chain",
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setChainSaving(false);
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

          {/* Letter Approval Chain */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <GitBranch className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Letter Approval Chain</CardTitle>
                  <CardDescription>
                    Ordered list of approval steps. Each letter is routed sequentially through these
                    roles. Leave empty for single-step approval.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {chain.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No chain configured — letters approve in a single step.
                </p>
              ) : (
                <div className="space-y-2">
                  {chain.map((step, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2 rounded-md border p-3"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {idx + 1}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`chain-role-${idx}`} className="text-xs">
                          Role (matches user.role)
                        </Label>
                        <Input
                          id={`chain-role-${idx}`}
                          placeholder="e.g. HRBP, CHRO"
                          value={step.role}
                          maxLength={64}
                          onChange={(e) => updateChainStep(idx, { role: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`chain-label-${idx}`} className="text-xs">
                          Display label
                        </Label>
                        <Input
                          id={`chain-label-${idx}`}
                          placeholder="e.g. HR Business Partner"
                          value={step.label}
                          maxLength={120}
                          onChange={(e) => updateChainStep(idx, { label: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveChainStep(idx, -1)}
                          disabled={idx === 0}
                          aria-label="Move up"
                        >
                          <ArrowDown className="h-4 w-4 rotate-180" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveChainStep(idx, 1)}
                          disabled={idx === chain.length - 1}
                          aria-label="Move down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeChainStep(idx)}
                          aria-label="Remove step"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addChainStep}
                  disabled={chain.length >= 10}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add step
                </Button>
                <div className="flex items-center gap-2">
                  {chainDirty && !chainSaving && (
                    <span className="text-xs text-muted-foreground">Unsaved changes</span>
                  )}
                  {chainHasEmptyRow && (
                    <span className="text-xs text-destructive">Fill all fields to save</span>
                  )}
                  <Button
                    onClick={() => void saveChain()}
                    disabled={!chainDirty || chainSaving || chainHasEmptyRow}
                    size="sm"
                  >
                    {chainSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save chain'
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
