"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────

export interface ConnectorTemplate {
  id: string;
  name: string;
  description: string;
  connectorType: "HRIS" | "PAYROLL" | "BENEFITS" | "SSO" | "CUSTOM";
  vendor: string;
  logoUrl?: string;
  category: string;
  authType: "oauth2" | "api_key" | "basic";
  sourceSchema: FieldSchema[];
  defaultSyncDirection: "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";
  defaultSyncSchedule: "REALTIME" | "HOURLY" | "DAILY" | "MANUAL";
  supportedEntities: string[];
  sandboxMode: boolean;
}

export interface FieldSchema {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  sampleValues?: string[];
}

export interface SuggestedMapping {
  sourceField: string;
  targetField: string;
  confidence: number;
  transformType: string;
  transformConfig: Record<string, unknown>;
  reasoning: string;
  defaultValue?: string;
}

export interface FieldMappingSuggestionResponse {
  tenantId: string;
  userId: string;
  suggestions: SuggestedMapping[];
  unmappedSource: string[];
  unmappedTarget: string[];
  overallConfidence: number;
}

export interface Connector {
  id: string;
  tenantId: string;
  name: string;
  connectorType: string;
  status: "ACTIVE" | "INACTIVE" | "ERROR" | "CONFIGURING";
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncJob {
  id: string;
  connectorId: string;
  tenantId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  syncType: string;
  recordsProcessed: number | null;
  recordsFailed: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface FieldMapping {
  id: string;
  connectorId: string;
  tenantId: string;
  sourceField: string;
  targetField: string;
  transformType: string;
  transformConfig: Record<string, unknown>;
  isRequired: boolean;
  defaultValue: string | null;
  enabled: boolean;
  createdAt: string;
}

// ─── Query Keys ─────────────────────────────────────────

const KEYS = {
  templates: ["integration-templates"] as const,
  connectors: ["integration-connectors"] as const,
  connector: (id: string) => ["integration-connector", id] as const,
  mappings: (connectorId: string) => ["field-mappings", connectorId] as const,
  syncJobs: (connectorId: string) => ["sync-jobs", connectorId] as const,
};

// ─── Template Hooks ─────────────────────────────────────

export function useConnectorTemplates() {
  return useQuery<ConnectorTemplate[]>({
    queryKey: KEYS.templates,
    queryFn: () =>
      apiClient.fetch<ConnectorTemplate[]>(
        "/api/v1/integrations/field-mappings/templates",
      ),
  });
}

// ─── Connector Hooks ────────────────────────────────────

export function useConnectors() {
  return useQuery<Connector[]>({
    queryKey: KEYS.connectors,
    queryFn: () =>
      apiClient.fetch<Connector[]>("/api/v1/integrations/connectors"),
  });
}

export function useConnector(id: string | null) {
  return useQuery<Connector>({
    queryKey: KEYS.connector(id ?? ""),
    queryFn: () =>
      apiClient.fetch<Connector>(`/api/v1/integrations/connectors/${id}`),
    enabled: !!id,
  });
}

export function useCreateConnector() {
  const qc = useQueryClient();
  return useMutation<
    Connector,
    Error,
    { name: string; connectorType: string; config: Record<string, unknown> }
  >({
    mutationFn: (data) =>
      apiClient.fetch<Connector>("/api/v1/integrations/connectors", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEYS.connectors });
    },
  });
}

// ─── Field Mapping Hooks ────────────────────────────────

export function useFieldMappingSuggestions() {
  const qc = useQueryClient();
  return useMutation<
    FieldMappingSuggestionResponse,
    Error,
    { templateId?: string; connectorType?: string; sourceFields?: FieldSchema[] }
  >({
    mutationFn: (data) =>
      apiClient.fetch<FieldMappingSuggestionResponse>(
        "/api/v1/integrations/field-mappings/suggest",
        { method: "POST", body: JSON.stringify(data) },
      ),
  });
}

export function useFieldMappings(connectorId: string | null) {
  return useQuery<FieldMapping[]>({
    queryKey: KEYS.mappings(connectorId ?? ""),
    queryFn: () =>
      apiClient.fetch<FieldMapping[]>(
        `/api/v1/integrations/field-mappings/connector/${connectorId}`,
      ),
    enabled: !!connectorId,
  });
}

export function useCreateFieldMapping() {
  const qc = useQueryClient();
  return useMutation<
    FieldMapping,
    Error,
    {
      connectorId: string;
      sourceField: string;
      targetField: string;
      transformType?: string;
      transformConfig?: Record<string, unknown>;
      isRequired?: boolean;
      defaultValue?: string;
    }
  >({
    mutationFn: (data) =>
      apiClient.fetch<FieldMapping>("/api/v1/integrations/field-mappings", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: KEYS.mappings(variables.connectorId),
      });
    },
  });
}

// ─── Sync Hooks ─────────────────────────────────────────

export function useSyncJobs(connectorId: string | null) {
  return useQuery<SyncJob[]>({
    queryKey: KEYS.syncJobs(connectorId ?? ""),
    queryFn: () =>
      apiClient.fetch<SyncJob[]>(
        `/api/v1/integrations/connectors/${connectorId}/sync-jobs`,
      ),
    enabled: !!connectorId,
  });
}

export function useTriggerSync() {
  const qc = useQueryClient();
  return useMutation<
    SyncJob,
    Error,
    { connectorId: string; syncType?: string }
  >({
    mutationFn: ({ connectorId, syncType }) =>
      apiClient.fetch<SyncJob>(
        `/api/v1/integrations/connectors/${connectorId}/sync`,
        {
          method: "POST",
          body: JSON.stringify({ syncType: syncType ?? "FULL" }),
        },
      ),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: KEYS.syncJobs(variables.connectorId),
      });
      void qc.invalidateQueries({ queryKey: KEYS.connectors });
    },
  });
}

export function useDeleteFieldMapping() {
  const qc = useQueryClient();
  return useMutation<{ deleted: boolean }, Error, { id: string; connectorId: string }>({
    mutationFn: ({ id }) =>
      apiClient.fetch<{ deleted: boolean }>(
        `/api/v1/integrations/field-mappings/${id}`,
        { method: "DELETE" },
      ),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: KEYS.mappings(variables.connectorId),
      });
    },
  });
}
