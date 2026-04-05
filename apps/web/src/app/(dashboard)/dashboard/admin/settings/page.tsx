'use client';

import { useState } from 'react';
import { Settings, Brain, Database, Shield, ToggleLeft, BarChart3, Save, Eye, EyeOff, Check, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfig, useSetConfigMutation, useAIPresets, useMarketDataPresets, useFeaturePresets } from '@/hooks/use-platform-config';

type TabId = 'ai' | 'market_data' | 'features' | 'security';

const TABS: { id: TabId; label: string; icon: typeof Brain }[] = [
  { id: 'ai', label: 'AI Models', icon: Brain },
  { id: 'market_data', label: 'Market Data', icon: BarChart3 },
  { id: 'features', label: 'Feature Flags', icon: ToggleLeft },
  { id: 'security', label: 'Security', icon: Shield },
];

export default function PlatformSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('ai');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Platform Settings</h1>
      </div>

      <div className="flex gap-2 border-b pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-t text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white border border-b-white text-blue-600 -mb-[1px]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'ai' && <AIConfigTab />}
      {activeTab === 'market_data' && <MarketDataTab />}
      {activeTab === 'features' && <FeaturesTab />}
      {activeTab === 'security' && <SecurityTab />}
    </div>
  );
}

// ─── AI Configuration Tab ──────────────────────────────────

function AIConfigTab() {
  const { data: config, isLoading } = useConfig('ai');
  const { data: presets } = useAIPresets();
  const mutation = useSetConfigMutation();
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  if (isLoading) return <LoadingSkeleton />;

  const settings = config?.settings ?? [];
  const schema = (presets as Record<string, unknown>)?.settingsSchema as Array<{
    key: string; type: string; label: string; options?: string[]; min?: number; max?: number;
  }> | undefined;

  const providers = (presets as Record<string, unknown>)?.providers as Array<{
    id: string; name: string; models: string[];
  }> | undefined;

  const tiers = (presets as Record<string, unknown>)?.tiers as Array<{
    id: string; name: string; description: string; recommended: string;
  }> | undefined;

  const getValue = (key: string) => editValues[key] ?? settings.find((s) => s.key === key)?.value ?? '';
  const isEdited = (key: string) => key in editValues;

  const handleSave = async (key: string, isSecret = false) => {
    const value = editValues[key];
    if (value === undefined) return;
    const desc = schema?.find((s) => s.key === key)?.label;
    await mutation.mutateAsync({ category: 'ai', key, value, isSecret, description: desc });
    setEditValues((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  return (
    <div className="space-y-6">
      {/* Provider & Model Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">AI Provider & Models</CardTitle>
          <CardDescription>Configure which AI provider and models power your agents</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Provider */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>AI Provider</Label>
              <select
                className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                value={getValue('provider')}
                onChange={(e) => setEditValues({ ...editValues, provider: e.target.value })}
              >
                {providers?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                )) ?? <option value="openai">OpenAI</option>}
              </select>
              {isEdited('provider') && (
                <Button size="sm" className="mt-1" onClick={() => handleSave('provider')}>
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              )}
            </div>
            <div>
              <Label>Default Model</Label>
              <select
                className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                value={getValue('default_model')}
                onChange={(e) => setEditValues({ ...editValues, default_model: e.target.value })}
              >
                {(providers?.find((p) => p.id === getValue('provider'))?.models ?? ['gpt-4o']).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {isEdited('default_model') && (
                <Button size="sm" className="mt-1" onClick={() => handleSave('default_model')}>
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              )}
            </div>
            <div>
              <Label>Monthly Budget / Tenant</Label>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-gray-500">$</span>
                <Input
                  type="number"
                  value={Number(getValue('monthly_budget_cents')) / 100 || 50}
                  onChange={(e) => setEditValues({ ...editValues, monthly_budget_cents: String(Math.round(Number(e.target.value) * 100)) })}
                  className="text-sm"
                />
              </div>
              {isEdited('monthly_budget_cents') && (
                <Button size="sm" className="mt-1" onClick={() => handleSave('monthly_budget_cents')}>
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Model Tiers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Model Tiers</CardTitle>
          <CardDescription>Assign different models to agent tiers for cost/quality optimization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {tiers?.map((tier) => (
              <div key={tier.id} className="flex items-start gap-4 p-3 rounded-lg border">
                <div className="flex-1">
                  <div className="font-medium text-sm">{tier.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{tier.description}</div>
                  <div className="text-xs text-blue-600 mt-1">Recommended: {tier.recommended}</div>
                </div>
                <div className="w-48">
                  <select
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    value={getValue(`model_${tier.id}`)}
                    onChange={(e) => setEditValues({ ...editValues, [`model_${tier.id}`]: e.target.value })}
                  >
                    <option value="">Use default</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
                    <option value="claude-haiku-4-5-20251001">claude-haiku-4.5</option>
                  </select>
                  {isEdited(`model_${tier.id}`) && (
                    <Button size="sm" className="mt-1 w-full" onClick={() => handleSave(`model_${tier.id}`)}>
                      <Save className="h-3 w-3 mr-1" /> Save
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">API Keys</CardTitle>
          <CardDescription>Manage API keys for AI providers. Keys are encrypted at rest.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {['openai_api_key', 'azure_api_key', 'azure_endpoint', 'azure_deployment', 'anthropic_api_key'].map((key) => {
            const isSecret = key.includes('api_key');
            const label = schema?.find((s) => s.key === key)?.label ?? key;
            const current = settings.find((s) => s.key === key);
            return (
              <div key={key} className="flex items-center gap-3">
                <div className="w-48">
                  <Label className="text-sm">{label}</Label>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <Input
                    type={isSecret && !showSecrets[key] ? 'password' : 'text'}
                    placeholder={current?.value === '••••••••' ? 'Configured (hidden)' : 'Not set'}
                    value={editValues[key] ?? ''}
                    onChange={(e) => setEditValues({ ...editValues, [key]: e.target.value })}
                    className="text-sm"
                  />
                  {isSecret && (
                    <button onClick={() => setShowSecrets({ ...showSecrets, [key]: !showSecrets[key] })}>
                      {showSecrets[key] ? <EyeOff className="h-4 w-4 text-gray-400" /> : <Eye className="h-4 w-4 text-gray-400" />}
                    </button>
                  )}
                  {isEdited(key) && (
                    <Button size="sm" onClick={() => handleSave(key, isSecret)}>
                      <Save className="h-3 w-3 mr-1" /> Save
                    </Button>
                  )}
                  {current && !isEdited(key) && (
                    <Badge variant={current.value === '••••••••' ? 'default' : 'secondary'} className="text-xs">
                      {current.value === '••••••••' ? <><Check className="h-3 w-3 mr-1" /> Set</> : 'Not set'}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Default Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Default Temperature</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={getValue('temperature_default') || '0.2'}
                onChange={(e) => setEditValues({ ...editValues, temperature_default: e.target.value })}
                className="mt-1 text-sm"
              />
              {isEdited('temperature_default') && (
                <Button size="sm" className="mt-1" onClick={() => handleSave('temperature_default')}>
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              )}
            </div>
            <div>
              <Label>Default Max Tokens</Label>
              <Input
                type="number"
                min="256"
                max="8192"
                value={getValue('max_tokens_default') || '2048'}
                onChange={(e) => setEditValues({ ...editValues, max_tokens_default: e.target.value })}
                className="mt-1 text-sm"
              />
              {isEdited('max_tokens_default') && (
                <Button size="sm" className="mt-1" onClick={() => handleSave('max_tokens_default')}>
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Market Data Tab ───────────────────────────────────────

function MarketDataTab() {
  const { data: config, isLoading } = useConfig('market_data');
  const { data: presets } = useMarketDataPresets();
  const mutation = useSetConfigMutation();
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  if (isLoading) return <LoadingSkeleton />;

  const providers = (presets as Record<string, unknown>)?.providers as Array<{
    id: string; name: string; region: string; cost: string;
    fields: Array<{ key: string; type: string; label: string; required: boolean }>;
  }> | undefined;

  const settings = config?.settings ?? [];

  const handleSave = async (key: string, isSecret: boolean) => {
    const value = editValues[key];
    if (value === undefined) return;
    await mutation.mutateAsync({ category: 'market_data', key, value, isSecret });
    setEditValues((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  return (
    <div className="space-y-4">
      {providers?.map((provider) => (
        <Card key={provider.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">{provider.name}</CardTitle>
                <CardDescription>{provider.region} &middot; {provider.cost}</CardDescription>
              </div>
              <Badge variant="outline">{provider.id}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {provider.fields.map((field) => {
                const isSecret = field.type === 'secret';
                const current = settings.find((s) => s.key === field.key);
                const hasValue = current && current.value !== '';
                return (
                  <div key={field.key} className="flex items-center gap-2">
                    <div className="flex-1">
                      <Label className="text-xs">{field.label} {field.required && <span className="text-red-500">*</span>}</Label>
                      <Input
                        type={isSecret ? 'password' : 'text'}
                        placeholder={hasValue ? '(configured)' : 'Not set'}
                        value={editValues[field.key] ?? ''}
                        onChange={(e) => setEditValues({ ...editValues, [field.key]: e.target.value })}
                        className="text-sm mt-1"
                      />
                    </div>
                    {editValues[field.key] !== undefined && (
                      <Button size="sm" className="mt-5" onClick={() => handleSave(field.key, isSecret)}>
                        <Save className="h-3 w-3" />
                      </Button>
                    )}
                    {hasValue && !editValues[field.key] && (
                      <Check className="h-4 w-4 text-green-500 mt-5" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Feature Flags Tab ─────────────────────────────────────

function FeaturesTab() {
  const { data: config, isLoading } = useConfig('features');
  const { data: presets } = useFeaturePresets();
  const mutation = useSetConfigMutation();

  if (isLoading) return <LoadingSkeleton />;

  const flags = (presets as Record<string, unknown>)?.flags as Array<{
    key: string; label: string; description: string; default: boolean;
  }> | undefined;

  const settings = config?.settings ?? [];

  const isEnabled = (key: string, defaultVal: boolean) => {
    const setting = settings.find((s) => s.key === key);
    if (!setting) return defaultVal;
    return setting.value === 'true';
  };

  const toggle = async (key: string, currentValue: boolean) => {
    await mutation.mutateAsync({
      category: 'features',
      key,
      value: String(!currentValue),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Feature Flags</CardTitle>
        <CardDescription>Enable or disable AI features globally. Changes take effect immediately.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {flags?.map((flag) => {
            const enabled = isEnabled(flag.key, flag.default);
            return (
              <div key={flag.key} className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <div className="font-medium text-sm">{flag.label}</div>
                  <div className="text-xs text-gray-500">{flag.description}</div>
                </div>
                <button
                  onClick={() => toggle(flag.key, enabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                  disabled={mutation.isPending}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${enabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Security Tab ──────────────────────────────────────────

function SecurityTab() {
  const { data: config, isLoading } = useConfig('security');
  const mutation = useSetConfigMutation();
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  if (isLoading) return <LoadingSkeleton />;

  const settings = config?.settings ?? [];

  const securitySettings = [
    { key: 'rate_limit_default', label: 'Default Rate Limit (req/min)', type: 'number', default: '60' },
    { key: 'rate_limit_auth', label: 'Auth Rate Limit (req/min)', type: 'number', default: '5' },
    { key: 'rate_limit_ai', label: 'AI Endpoint Rate Limit (req/min)', type: 'number', default: '20' },
    { key: 'lockout_attempts', label: 'Account Lockout After N Attempts', type: 'number', default: '5' },
    { key: 'lockout_duration_min', label: 'Lockout Duration (minutes)', type: 'number', default: '30' },
    { key: 'session_timeout_hours', label: 'Session Timeout (hours)', type: 'number', default: '24' },
    { key: 'max_concurrent_sessions', label: 'Max Concurrent Sessions per User', type: 'number', default: '5' },
  ];

  const getValue = (key: string, defaultVal: string) =>
    editValues[key] ?? settings.find((s) => s.key === key)?.value ?? defaultVal;

  const handleSave = async (key: string) => {
    const value = editValues[key];
    if (value === undefined) return;
    await mutation.mutateAsync({ category: 'security', key, value });
    setEditValues((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Security Settings</CardTitle>
        <CardDescription>Rate limiting, account lockout, and session management</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {securitySettings.map((setting) => (
            <div key={setting.key}>
              <Label className="text-sm">{setting.label}</Label>
              <Input
                type="number"
                value={getValue(setting.key, setting.default)}
                onChange={(e) => setEditValues({ ...editValues, [setting.key]: e.target.value })}
                className="mt-1 text-sm"
              />
              {editValues[setting.key] !== undefined && (
                <Button size="sm" className="mt-1" onClick={() => handleSave(setting.key)}>
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Shared Components ─────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((k) => (
        <Skeleton key={k} className="h-48 w-full" />
      ))}
    </div>
  );
}
