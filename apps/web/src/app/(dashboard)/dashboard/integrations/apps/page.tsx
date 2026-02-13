"use client";

import { useState } from "react";
import { Link2, CheckCircle2, AlertCircle, Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConnectorTemplates, useConnectors, useCreateConnector, type ConnectorTemplate } from "@/hooks/use-integrations";

function typeBadge(type: string) {
  const colors: Record<string, string> = {
    HRIS: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    PAYROLL: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    BENEFITS: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[type] ?? "bg-gray-100 text-gray-800"}`}>
      {type}
    </span>
  );
}

function statusIcon(status: string) {
  if (status === "ACTIVE") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "ERROR") return <AlertCircle className="h-4 w-4 text-red-500" />;
  return <div className="h-4 w-4 rounded-full bg-gray-300" />;
}

export default function ConnectedAppsPage() {
  const { data: templates, isLoading: templatesLoading } = useConnectorTemplates();
  const { data: connectors, isLoading: connectorsLoading } = useConnectors();
  const createConnector = useCreateConnector();
  const [settingUp, setSettingUp] = useState<string | null>(null);

  const connectedIds = new Set((connectors ?? []).map((c) => c.connectorType));

  function handleSetup(template: ConnectorTemplate) {
    setSettingUp(template.id);
    createConnector.mutate(
      {
        name: template.name,
        connectorType: template.connectorType,
        config: { templateId: template.id, sandboxMode: true },
      },
      { onSettled: () => setSettingUp(null) },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Connector Marketplace</h1>
          <p className="text-muted-foreground">
            Connect your HR systems with pre-built connectors or build custom integrations.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          {(connectors ?? []).length} Connected
        </Badge>
      </div>

      {/* Active Connectors */}
      {(connectors ?? []).length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Active Connectors</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(connectors ?? []).map((c) => (
              <Card key={c.id} className="border-green-200 dark:border-green-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {statusIcon(c.status)}
                      <CardTitle className="text-base">{c.name}</CardTitle>
                    </div>
                    <Badge variant={c.status === "ACTIVE" ? "default" : "outline"} className="text-xs">
                      {c.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Last sync: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleDateString() : "Never"}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Available Templates */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Available Connectors</h2>
        {templatesLoading || connectorsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(templates ?? []).map((template) => {
              const isConnected = connectedIds.has(template.connectorType);
              return (
                <Card key={template.id} className={isConnected ? "opacity-60" : ""}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                          <Link2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{template.name}</CardTitle>
                          <p className="text-xs text-muted-foreground">{template.vendor}</p>
                        </div>
                      </div>
                      {typeBadge(template.connectorType)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">{template.description}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {template.supportedEntities.slice(0, 3).map((e) => (
                          <Badge key={e} variant="outline" className="text-xs">{e}</Badge>
                        ))}
                      </div>
                      {isConnected ? (
                        <Badge variant="default" className="text-xs">Connected</Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleSetup(template)}
                          disabled={settingUp === template.id}
                        >
                          {settingUp === template.id ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Plus className="mr-1 h-3 w-3" />
                          )}
                          Setup
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

