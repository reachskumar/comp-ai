'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Upload, Loader2, CheckCircle2, Search, X, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useAdminOnboard, useCompportTenants } from '@/hooks/use-admin';

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
  const { data: compportData, isLoading: tenantsLoading } = useCompportTenants();

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

  // Searchable dropdown state
  const [companySearch, setCompanySearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const compportTenants = compportData?.tenants ?? [];
  const filteredTenants = useMemo(() => {
    if (!companySearch) return compportTenants;
    const q = companySearch.toLowerCase();
    return compportTenants.filter(
      (t) => t.companyName.toLowerCase().includes(q) || t.schemaName.toLowerCase().includes(q),
    );
  }, [compportTenants, companySearch]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
      setCompanySearch('');
      setManualEntry(false);
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
            {/* Compport Company Selector */}
            <div className="space-y-1 col-span-2">
              <div className="flex items-center justify-between">
                <Label>Compport Company *</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={() => {
                    setManualEntry(!manualEntry);
                    if (!manualEntry) {
                      setDropdownOpen(false);
                    }
                  }}
                >
                  {manualEntry ? 'Select from list' : 'Enter manually'}
                </button>
              </div>

              {manualEntry ? (
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    value={form.companyName}
                    onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                    placeholder="e.g. Standard Bank"
                  />
                  <div>
                    <Input
                      value={form.compportSchema}
                      onChange={(e) => setForm((f) => ({ ...f, compportSchema: e.target.value }))}
                      placeholder="e.g. 200326_1585209819"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      MySQL schema name for data sync
                    </p>
                  </div>
                </div>
              ) : (
                <div className="relative" ref={dropdownRef}>
                  <div
                    className="flex items-center gap-2 w-full h-9 rounded-md border px-3 text-sm cursor-pointer hover:bg-accent/50"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                  >
                    {form.companyName ? (
                      <div className="flex items-center justify-between w-full">
                        <span>
                          {form.companyName}{' '}
                          <span className="text-muted-foreground">({form.compportSchema})</span>
                        </span>
                        <X
                          className="h-4 w-4 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setForm((f) => ({ ...f, companyName: '', compportSchema: '' }));
                            setCompanySearch('');
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between w-full text-muted-foreground">
                        <span>
                          {tenantsLoading ? 'Loading companies…' : 'Select a Compport company'}
                        </span>
                        <ChevronDown className="h-4 w-4" />
                      </div>
                    )}
                  </div>

                  {dropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
                      <div className="flex items-center gap-2 px-3 py-2 border-b">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <input
                          autoFocus
                          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                          placeholder="Search companies…"
                          value={companySearch}
                          onChange={(e) => setCompanySearch(e.target.value)}
                        />
                        {companySearch && (
                          <X
                            className="h-3 w-3 text-muted-foreground cursor-pointer"
                            onClick={() => setCompanySearch('')}
                          />
                        )}
                      </div>
                      <div className="max-h-60 overflow-y-auto">
                        {filteredTenants.length === 0 ? (
                          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                            {tenantsLoading ? 'Loading…' : 'No companies found'}
                          </div>
                        ) : (
                          filteredTenants.map((t) => (
                            <div
                              key={t.schemaName}
                              className="flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-accent/50"
                              onClick={() => {
                                setForm((f) => ({
                                  ...f,
                                  companyName: t.companyName,
                                  compportSchema: t.schemaName,
                                }));
                                setDropdownOpen(false);
                                setCompanySearch('');
                              }}
                            >
                              <span className="font-medium">{t.companyName}</span>
                              <span className="text-xs text-muted-foreground">{t.schemaName}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="px-3 py-1.5 border-t text-xs text-muted-foreground">
                        {filteredTenants.length} of {compportTenants.length} companies
                      </div>
                    </div>
                  )}
                </div>
              )}
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
