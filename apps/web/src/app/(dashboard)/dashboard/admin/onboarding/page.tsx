'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Upload, Loader2, CheckCircle2, X, Search, ChevronDown } from 'lucide-react';
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
  const [schemaAutoFilled, setSchemaAutoFilled] = useState(false);

  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const filteredTenants = useMemo(() => {
    const tenants = compportData?.tenants ?? [];
    if (!searchQuery) return tenants;
    const q = searchQuery.toLowerCase();
    return tenants.filter(
      (t) => t.companyName.toLowerCase().includes(q) || t.schemaName.toLowerCase().includes(q),
    );
  }, [compportData?.tenants, searchQuery]);

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

  const handleSelectCompany = (companyName: string, schemaName: string) => {
    setForm((f) => ({ ...f, companyName, compportSchema: schemaName }));
    setSchemaAutoFilled(true);
    setSearchQuery('');
    setDropdownOpen(false);
  };

  const handleClearSchema = () => {
    setForm((f) => ({ ...f, compportSchema: '' }));
    setSchemaAutoFilled(false);
  };

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
      setSchemaAutoFilled(false);
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
          Create a new tenant from a Compport Cloud SQL schema
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer Details</CardTitle>
          <CardDescription>
            Select a company from the Compport registry or enter details manually
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Searchable Company Dropdown */}
            <div className="space-y-1" ref={dropdownRef}>
              <Label>Company Name *</Label>
              <div className="relative">
                <div
                  className="flex items-center w-full h-9 rounded-md border px-3 text-sm cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <span className={form.companyName ? 'text-foreground' : 'text-muted-foreground'}>
                    {form.companyName || 'Select or type a company...'}
                  </span>
                  <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
                </div>

                {dropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
                    <div className="flex items-center border-b px-3 py-2">
                      <Search className="h-4 w-4 text-muted-foreground mr-2" />
                      <input
                        autoFocus
                        className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                        placeholder="Search companies..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setForm((f) => ({ ...f, companyName: e.target.value }));
                          setSchemaAutoFilled(false);
                        }}
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {tenantsLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          <span className="text-sm text-muted-foreground">
                            Loading Compport tenants...
                          </span>
                        </div>
                      ) : filteredTenants.length === 0 ? (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                          {searchQuery
                            ? 'No matching companies found. Name will be used as-is.'
                            : 'No Compport tenants available'}
                        </div>
                      ) : (
                        filteredTenants.map((t) => (
                          <button
                            key={t.schemaName}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between"
                            onClick={() => handleSelectCompany(t.companyName, t.schemaName)}
                          >
                            <div>
                              <div className="font-medium">{t.companyName}</div>
                              <div className="text-xs text-muted-foreground">
                                Schema: {t.schemaName}
                                {t.employeeCount != null && ` · ${t.employeeCount} employees`}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Schema Name (auto-filled or manual) */}
            <div className="space-y-1">
              <Label>Compport Schema Name *</Label>
              <div className="relative">
                <Input
                  value={form.compportSchema}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, compportSchema: e.target.value }));
                    setSchemaAutoFilled(false);
                  }}
                  placeholder="200326_1585209819"
                  readOnly={schemaAutoFilled}
                  className={schemaAutoFilled ? 'bg-muted pr-8' : ''}
                />
                {schemaAutoFilled && (
                  <button
                    onClick={handleClearSchema}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
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
