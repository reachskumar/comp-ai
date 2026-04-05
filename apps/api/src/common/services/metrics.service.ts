import { Injectable, Logger } from '@nestjs/common';

/**
 * Lightweight Prometheus-compatible metrics collector.
 * Exposes metrics at /metrics endpoint in Prometheus exposition format.
 *
 * Tracks: HTTP request counts/latency, AI token usage/cost, error rates.
 */

interface HistogramBucket {
  le: number;
  count: number;
}

interface MetricEntry {
  labels: Record<string, string>;
  value: number;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // Counters
  private httpRequestsTotal = new Map<string, number>();
  private httpErrorsTotal = new Map<string, number>();
  private aiTokensUsed = new Map<string, number>();
  private aiRequestsTotal = new Map<string, number>();
  private aiCostCents = new Map<string, number>(); // cost in cents to avoid float

  // Histograms (simplified bucket approach)
  private httpDurationBuckets: Array<{ le: number; counts: Map<string, number> }> = [
    { le: 0.05, counts: new Map() },
    { le: 0.1, counts: new Map() },
    { le: 0.25, counts: new Map() },
    { le: 0.5, counts: new Map() },
    { le: 1, counts: new Map() },
    { le: 2.5, counts: new Map() },
    { le: 5, counts: new Map() },
    { le: 10, counts: new Map() },
  ];
  private httpDurationSum = new Map<string, number>();
  private httpDurationCount = new Map<string, number>();

  // Gauges
  private activeConnections = 0;

  // ─── Record Methods ─────────────────────────────────────

  recordHttpRequest(method: string, path: string, statusCode: number, durationMs: number) {
    const routeLabel = this.normalizePath(path);
    const key = `${method}|${routeLabel}|${statusCode}`;
    this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) ?? 0) + 1);

    if (statusCode >= 400) {
      const errorKey = `${method}|${routeLabel}|${statusCode}`;
      this.httpErrorsTotal.set(errorKey, (this.httpErrorsTotal.get(errorKey) ?? 0) + 1);
    }

    // Histogram
    const durationSec = durationMs / 1000;
    const histKey = `${method}|${routeLabel}`;
    this.httpDurationSum.set(histKey, (this.httpDurationSum.get(histKey) ?? 0) + durationSec);
    this.httpDurationCount.set(histKey, (this.httpDurationCount.get(histKey) ?? 0) + 1);
    for (const bucket of this.httpDurationBuckets) {
      if (durationSec <= bucket.le) {
        bucket.counts.set(histKey, (bucket.counts.get(histKey) ?? 0) + 1);
      }
    }
  }

  recordAiUsage(tenantId: string, agentType: string, inputTokens: number, outputTokens: number) {
    const key = `${tenantId}|${agentType}`;
    const totalTokens = inputTokens + outputTokens;
    this.aiTokensUsed.set(key, (this.aiTokensUsed.get(key) ?? 0) + totalTokens);
    this.aiRequestsTotal.set(key, (this.aiRequestsTotal.get(key) ?? 0) + 1);

    // Cost estimation (GPT-4o pricing: $2.50/1M input, $10/1M output)
    const costCents = Math.round((inputTokens * 0.00025 + outputTokens * 0.001) * 100);
    this.aiCostCents.set(key, (this.aiCostCents.get(key) ?? 0) + costCents);
  }

  setActiveConnections(count: number) {
    this.activeConnections = count;
  }

  // ─── AI Cost Controls ───────────────────────────────────

  getTenantAiCostCents(tenantId: string): number {
    let total = 0;
    for (const [key, cost] of this.aiCostCents) {
      if (key.startsWith(`${tenantId}|`)) total += cost;
    }
    return total;
  }

  getTenantAiTokens(tenantId: string): number {
    let total = 0;
    for (const [key, tokens] of this.aiTokensUsed) {
      if (key.startsWith(`${tenantId}|`)) total += tokens;
    }
    return total;
  }

  // ─── Prometheus Export ──────────────────────────────────

  toPrometheus(): string {
    const lines: string[] = [];

    // HTTP requests total
    lines.push('# HELP http_requests_total Total HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, count] of this.httpRequestsTotal) {
      const [method, route, status] = key.split('|');
      lines.push(`http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`);
    }

    // HTTP errors total
    lines.push('# HELP http_errors_total Total HTTP errors (4xx/5xx)');
    lines.push('# TYPE http_errors_total counter');
    for (const [key, count] of this.httpErrorsTotal) {
      const [method, route, status] = key.split('|');
      lines.push(`http_errors_total{method="${method}",route="${route}",status="${status}"} ${count}`);
    }

    // HTTP duration histogram
    lines.push('# HELP http_request_duration_seconds HTTP request duration');
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [key] of this.httpDurationCount) {
      const [method, route] = key.split('|');
      for (const bucket of this.httpDurationBuckets) {
        const bucketCount = bucket.counts.get(key) ?? 0;
        lines.push(`http_request_duration_seconds_bucket{method="${method}",route="${route}",le="${bucket.le}"} ${bucketCount}`);
      }
      lines.push(`http_request_duration_seconds_sum{method="${method}",route="${route}"} ${this.httpDurationSum.get(key) ?? 0}`);
      lines.push(`http_request_duration_seconds_count{method="${method}",route="${route}"} ${this.httpDurationCount.get(key) ?? 0}`);
    }

    // Active connections gauge
    lines.push('# HELP active_connections Current active connections');
    lines.push('# TYPE active_connections gauge');
    lines.push(`active_connections ${this.activeConnections}`);

    // AI token usage
    lines.push('# HELP ai_tokens_used_total Total AI tokens consumed');
    lines.push('# TYPE ai_tokens_used_total counter');
    for (const [key, tokens] of this.aiTokensUsed) {
      const [tenantId, agent] = key.split('|');
      lines.push(`ai_tokens_used_total{tenant="${tenantId}",agent="${agent}"} ${tokens}`);
    }

    // AI requests
    lines.push('# HELP ai_requests_total Total AI agent requests');
    lines.push('# TYPE ai_requests_total counter');
    for (const [key, count] of this.aiRequestsTotal) {
      const [tenantId, agent] = key.split('|');
      lines.push(`ai_requests_total{tenant="${tenantId}",agent="${agent}"} ${count}`);
    }

    // AI cost (in dollars)
    lines.push('# HELP ai_cost_dollars_total Estimated AI cost in dollars');
    lines.push('# TYPE ai_cost_dollars_total counter');
    for (const [key, cents] of this.aiCostCents) {
      const [tenantId, agent] = key.split('|');
      lines.push(`ai_cost_dollars_total{tenant="${tenantId}",agent="${agent}"} ${cents / 100}`);
    }

    // Process metrics
    const mem = process.memoryUsage();
    lines.push('# HELP process_heap_bytes Process heap memory in bytes');
    lines.push('# TYPE process_heap_bytes gauge');
    lines.push(`process_heap_bytes ${mem.heapUsed}`);

    lines.push('# HELP process_rss_bytes Process RSS in bytes');
    lines.push('# TYPE process_rss_bytes gauge');
    lines.push(`process_rss_bytes ${mem.rss}`);

    lines.push('# HELP process_uptime_seconds Process uptime');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);

    return lines.join('\n') + '\n';
  }

  private normalizePath(path: string): string {
    // Replace UUIDs/CUIDs with :id placeholder
    return path
      .replace(/\/[a-f0-9-]{36}/g, '/:id')
      .replace(/\/c[a-z0-9]{24,}/g, '/:id')
      .replace(/\/\d+/g, '/:id');
  }
}
