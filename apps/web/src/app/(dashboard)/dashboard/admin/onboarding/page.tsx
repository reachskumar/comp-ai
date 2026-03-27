'use client';

import { useState } from 'react';
import { Upload, Loader2, Building2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useAdminOnboard } from '@/hooks/use-admin';

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
  const [onboarded, setOnboarded] = useState<string[]>([]);

  const handleOnboard = async () => {
    if (!form.companyName || !form.compportSchema) {
      toast({ title: 'Company name and Compport schema are required', variant: 'destructive' });
      return;
    }
    try {
      await onboard.mutateAsync(form);
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
          <CardDescription>Enter the Compport schema name and customer information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Company Name *</Label>
              <Input
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                placeholder="Standard Bank"
              />
            </div>
            <div className="space-y-1">
              <Label>Compport Schema Name *</Label>
              <Input
                value={form.compportSchema}
                onChange={(e) => setForm((f) => ({ ...f, compportSchema: e.target.value }))}
                placeholder="200326_1585209819"
              />
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
          <Button onClick={handleOnboard} disabled={onboard.isPending}>
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
