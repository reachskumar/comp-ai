'use client';

import { useState } from 'react';
import { DollarSign, RefreshCw, Plus, Loader2, Globe } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useExchangeRates,
  useSupportedCurrencies,
  useCreateExchangeRateMutation,
  useFetchLatestRatesMutation,
  useUpdateCurrencySettingsMutation,
} from '@/hooks/use-currency';
import { COMMON_CURRENCIES, formatCurrency } from '@compensation/shared';

export default function CurrencySettingsPage() {
  const { data: rates, isLoading: ratesLoading } = useExchangeRates();
  const { data: settings, isLoading: settingsLoading } = useSupportedCurrencies();
  const createRate = useCreateExchangeRateMutation();
  const fetchRates = useFetchLatestRatesMutation();
  const updateSettings = useUpdateCurrencySettingsMutation();

  const [newFrom, setNewFrom] = useState('USD');
  const [newTo, setNewTo] = useState('EUR');
  const [newRate, setNewRate] = useState('');
  const [addCurrency, setAddCurrency] = useState('');

  const loading = ratesLoading || settingsLoading;
  const baseCurrency = settings?.baseCurrency || 'USD';
  const supported = settings?.supportedCurrencies || ['USD'];

  const handleAddRate = () => {
    if (!newRate || !newFrom || !newTo) return;
    createRate.mutate(
      { fromCurrency: newFrom, toCurrency: newTo, rate: parseFloat(newRate), source: 'MANUAL' },
      { onSuccess: () => setNewRate('') },
    );
  };

  const handleAddCurrency = () => {
    if (!addCurrency || supported.includes(addCurrency)) return;
    updateSettings.mutate(
      { supportedCurrencies: [...supported, addCurrency] },
      { onSuccess: () => setAddCurrency('') },
    );
  };

  const handleRemoveCurrency = (code: string) => {
    if (code === baseCurrency) return;
    updateSettings.mutate({
      supportedCurrencies: supported.filter((c) => c !== code),
    });
  };

  const handleSetBase = (code: string) => {
    const newSupported = supported.includes(code) ? supported : [...supported, code];
    updateSettings.mutate({ baseCurrency: code, supportedCurrencies: newSupported });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Currency Settings</h1>
        <p className="text-muted-foreground">
          Manage base currency, supported currencies, and exchange rates.
        </p>
      </div>

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
      ) : (
        <>
          {/* Base Currency & Supported Currencies */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <DollarSign className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Base Currency</CardTitle>
                    <CardDescription>Primary currency for reporting</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Select
                  value={baseCurrency}
                  onChange={(e) => handleSetBase(e.target.value)}
                  options={COMMON_CURRENCIES.map((c) => ({
                    value: c.code,
                    label: `${c.code} — ${c.name}`,
                  }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Globe className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Supported Currencies</CardTitle>
                    <CardDescription>Currencies available across the platform</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {supported.map((code) => (
                    <Badge
                      key={code}
                      variant={code === baseCurrency ? 'default' : 'secondary'}
                      className="cursor-pointer"
                      onClick={() => code !== baseCurrency && handleRemoveCurrency(code)}
                    >
                      {code} {code === baseCurrency ? '(base)' : '×'}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Select
                    value={addCurrency}
                    onChange={(e) => setAddCurrency(e.target.value)}
                    options={COMMON_CURRENCIES.filter((c) => !supported.includes(c.code)).map(
                      (c) => ({ value: c.code, label: `${c.code} — ${c.name}` }),
                    )}
                    placeholder="Add currency..."
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleAddCurrency} disabled={!addCurrency}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator />

          {/* Exchange Rates */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <RefreshCw className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Exchange Rates</CardTitle>
                    <CardDescription>
                      Current exchange rates for currency conversion
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => fetchRates.mutate()}
                  disabled={fetchRates.isPending}
                >
                  {fetchRates.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Fetch Latest Rates
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add Rate Form */}
              <div className="flex items-end gap-3 p-4 rounded-lg border bg-muted/50">
                <div className="space-y-1">
                  <Label className="text-xs">From</Label>
                  <Select
                    value={newFrom}
                    onChange={(e) => setNewFrom(e.target.value)}
                    options={supported.map((c) => ({ value: c, label: c }))}
                    className="w-24"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To</Label>
                  <Select
                    value={newTo}
                    onChange={(e) => setNewTo(e.target.value)}
                    options={supported
                      .filter((c) => c !== newFrom)
                      .map((c) => ({ value: c, label: c }))}
                    className="w-24"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Rate</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="1.000000"
                    value={newRate}
                    onChange={(e) => setNewRate(e.target.value)}
                    className="w-32"
                  />
                </div>
                <Button onClick={handleAddRate} disabled={createRate.isPending || !newRate}>
                  {createRate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Rate'}
                </Button>
              </div>

              {/* Rates Table */}
              {rates && rates.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Example</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Effective Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rates.map((rate) => (
                      <TableRow key={rate.id}>
                        <TableCell className="font-medium">{rate.fromCurrency}</TableCell>
                        <TableCell className="font-medium">{rate.toCurrency}</TableCell>
                        <TableCell className="font-mono">{Number(rate.rate).toFixed(6)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatCurrency(1000, rate.fromCurrency)} ={' '}
                          {formatCurrency(1000 * Number(rate.rate), rate.toCurrency)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={rate.source === 'MANUAL' ? 'outline' : 'secondary'}>
                            {rate.source}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(rate.effectiveDate).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No exchange rates configured yet.</p>
                  <p className="text-sm">Add rates manually or fetch the latest rates.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
