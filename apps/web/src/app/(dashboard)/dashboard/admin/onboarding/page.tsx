'use client';

import { useState } from 'react';
import { Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useAdminOnboard } from '@/hooks/use-admin';

/** Canonical feature keys — keep in sync with backend FEATURE_KEYS */
const ALL_FEATURES: { key: string; label: string }[] = [
  { key: 'ai_features', label: 'AI Features' },
  { key: 'data_hygiene', label: 'Data Hygiene' },
  { key: 'comp_cycles', label: 'Comp Cycles' },
  { key: 'payroll_guard', label: 'Payroll Guard' },
  { key: 'benefits', label: 'Benefits' },
  { key: 'organization', label: 'Organization' },
  { key: 'equity_plans', label: 'Equity Plans' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'integrations', label: 'Integrations' },
];

export default function AdminOnboardingPage() {
  const { toast } = useToast();
  const onboard = useAdminOnboard();

  const [form, setForm] = useState({
    companyName: '',
    compportSchema: '',
    subdomain: '',
    adminEmail: '',
    adminName: '',
    adminPassword: '',
    adminRole: 'ADMIN',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [onboarded, setOnboarded] = useState<string[]>([]);
  const [enabledFeatures, setEnabledFeatures] = useState<string[]>(ALL_FEATURES.map((f) => f.key));

  const passwordMismatch =
    form.adminPassword.length > 0 &&
    confirmPassword.length > 0 &&
    form.adminPassword !== confirmPassword;

  const toggleFeature = (key: string) => {
    setEnabledFeatures((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key],
    );
  };

  const selectAllFeatures = () => setEnabledFeatures(ALL_FEATURES.map((f) => f.key));
  const clearAllFeatures = () => setEnabledFeatures([]);

  const handleOnboard = async () => {
    if (!form.companyName || !form.compportSchema) {
      toast({ title: 'Company name and Compport schema are required', variant: 'destructive' });
      return;
    }
    if (passwordMismatch) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    try {
      await onboard.mutateAsync({ ...form, enabledFeatures });
      setOnboarded((prev) => [...prev, form.companyName]);
      toast({ title: `Onboarded: ${form.companyName}` });
      setForm({
        companyName: '',
        compportSchema: '',
        subdomain: '',
        adminEmail: '',
        adminName: '',
        adminPassword: '',
        adminRole: 'ADMIN',
      });
      setConfirmPassword('');
      setEnabledFeatures(ALL_FEATURES.map((f) => f.key));
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Onboarding failed',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Onboard Customer</h1>
        <p className="text-sm text-muted-foreground">
          Create a new tenant and map it to a Compport schema for data sync
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer Details</CardTitle>
          <CardDescription>
            Enter company details and the Compport schema name for data sync
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Company Name */}
            <div className="space-y-1">
              <Label>Company Name *</Label>
              <Input
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                placeholder="e.g. Standard Bank"
              />
            </div>

            {/* Schema Name */}
            <div className="space-y-1">
              <Label>Compport Schema Name *</Label>
              <Input
                value={form.compportSchema}
                onChange={(e) => setForm((f) => ({ ...f, compportSchema: e.target.value }))}
                placeholder="e.g. 200326_1585209819"
              />
              <p className="text-xs text-muted-foreground">
                The MySQL schema name used for inbound data sync
              </p>
            </div>

            <div className="space-y-1">
              <Label>Subdomain</Label>
              <div className="flex items-center gap-1">
                <Input
                  value={form.subdomain}
                  onChange={(e) => setForm((f) => ({ ...f, subdomain: e.target.value }))}
                  placeholder="standardbank"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  .compportiq.ai
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Admin Email</Label>
              <Input
                value={form.adminEmail}
                onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                placeholder="admin@company.com"
              />
            </div>
            <div className="space-y-1">
              <Label>Admin Name</Label>
              <Input
                value={form.adminName}
                onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <Input
                type="password"
                value={form.adminPassword}
                onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))}
                placeholder="Min 8 characters"
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">
                Min 8 chars, uppercase, lowercase, number &amp; special character
              </p>
            </div>
            <div className="space-y-1">
              <Label>Confirm Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
              />
              {passwordMismatch && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <select
                className="w-full h-9 rounded-md border px-3 text-sm"
                value={form.adminRole}
                onChange={(e) => setForm((f) => ({ ...f, adminRole: e.target.value }))}
              >
                {['ADMIN', 'HR_MANAGER', 'MANAGER', 'ANALYST', 'EMPLOYEE'].map((r) => (
                  <option key={r} value={r}>
                    {r.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Feature Selection */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Enabled Features</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={selectAllFeatures}
                  className="text-xs h-7"
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFeatures}
                  className="text-xs h-7"
                >
                  Clear All
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              Select which modules will be visible to this tenant
            </p>
            <div className="grid grid-cols-3 gap-2">
              {ALL_FEATURES.map((feature) => (
                <label
                  key={feature.key}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={enabledFeatures.includes(feature.key)}
                    onChange={() => toggleFeature(feature.key)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm">{feature.label}</span>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={handleOnboard} disabled={onboard.isPending || passwordMismatch}>
            {onboard.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Onboard Customer
          </Button>
        </CardContent>
      </Card>

      {onboarded.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recently Onboarded</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {onboarded.map((name) => (
              <div key={name} className="flex items-center gap-2 py-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{name}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
