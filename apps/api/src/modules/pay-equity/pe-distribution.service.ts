/**
 * Phase 3.7 + 5.5 + 6.4 — Distribution surface.
 *
 * - Subscription CRUD (3.7 scheduled report delivery + 6.4 CHRO digest)
 * - Cron scanner (one method, called by a BullMQ repeat or external scheduler)
 * - Slack webhook helper
 * - Email delivery (delegates to LettersEmailService)
 * - Share-token CRUD (5.5 external auditor portal)
 *
 * Lives in its own service to keep the main PayEquityV2Service focused on
 * analysis. Shares the same database + audit log conventions.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@compensation/database';
import { DatabaseService } from '../../database';
import { LetterEmailService } from '../letters/email.service';
import { PayEquityV2Service } from './pay-equity.service';
import { renderReport, REPORT_TYPES, type ReportType } from './report-renderers';
import type { PayEquityAgentResult } from '@compensation/ai';
import type { PayEquityReport } from '../analytics/pay-equity.service';

const VALID_CADENCES = ['daily', 'weekly', 'monthly', 'quarterly'] as const;
type Cadence = (typeof VALID_CADENCES)[number];

const VALID_SHARE_SCOPES = ['auditor', 'defensibility', 'methodology'] as const;
type ShareScope = (typeof VALID_SHARE_SCOPES)[number];

@Injectable()
export class PEDistributionService {
  private readonly logger = new Logger(PEDistributionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly email: LetterEmailService,
    private readonly pe: PayEquityV2Service,
  ) {}

  // ─── Subscriptions (3.7 + 6.4) ──────────────────────────────────

  async listSubscriptions(tenantId: string) {
    return this.db.forTenant(tenantId, (tx) =>
      tx.pEReportSubscription.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async createSubscription(
    tenantId: string,
    userId: string,
    input: {
      reportType: string;
      cadence: string;
      recipients: string[];
      slackWebhook?: string;
    },
  ) {
    const reportType = input.reportType;
    if (reportType !== 'digest' && !REPORT_TYPES.includes(reportType as ReportType)) {
      throw new BadRequestException(
        `Unknown reportType: ${reportType}. Valid: ${[...REPORT_TYPES, 'digest'].join(', ')}`,
      );
    }
    if (!VALID_CADENCES.includes(input.cadence as Cadence)) {
      throw new BadRequestException(
        `Unknown cadence: ${input.cadence}. Valid: ${VALID_CADENCES.join(', ')}`,
      );
    }
    if (input.recipients.length === 0 && !input.slackWebhook) {
      throw new BadRequestException('At least one recipient email or a Slack webhook is required.');
    }

    const nextRunAt = computeNextRunAt(new Date(), input.cadence as Cadence);

    const sub = await this.db.forTenant(tenantId, (tx) =>
      tx.pEReportSubscription.create({
        data: {
          tenantId,
          reportType,
          cadence: input.cadence,
          recipients: input.recipients,
          slackWebhook: input.slackWebhook ?? null,
          createdById: userId,
          nextRunAt,
        },
      }),
    );

    await this.db.forTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'PAY_EQUITY_SUBSCRIPTION_CREATED',
          entityType: 'PEReportSubscription',
          entityId: sub.id,
          changes: {
            reportType,
            cadence: input.cadence,
            recipientCount: input.recipients.length,
            hasSlack: !!input.slackWebhook,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    );

    return sub;
  }

  async deleteSubscription(tenantId: string, subscriptionId: string, userId: string) {
    const sub = await this.db.forTenant(tenantId, (tx) =>
      tx.pEReportSubscription.findFirst({
        where: { id: subscriptionId, tenantId },
      }),
    );
    if (!sub) throw new NotFoundException(`Subscription ${subscriptionId} not found`);

    await this.db.forTenant(tenantId, async (tx) => {
      await tx.pEReportSubscription.delete({ where: { id: subscriptionId } });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'PAY_EQUITY_SUBSCRIPTION_DELETED',
          entityType: 'PEReportSubscription',
          entityId: subscriptionId,
          changes: { reportType: sub.reportType } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return { deleted: true };
  }

  /**
   * Cron scanner — finds subscriptions whose nextRunAt is in the past, runs
   * them, and reschedules. Called by a BullMQ repeat (or any external
   * scheduler hitting an internal endpoint). Idempotent: re-running within
   * the same minute is a no-op for already-processed rows.
   */
  async runDueSubscriptions(now = new Date()) {
    const due = await this.db.client.pEReportSubscription.findMany({
      where: {
        active: true,
        OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }],
      },
      take: 50,
    });

    let dispatched = 0;
    let failed = 0;

    for (const sub of due) {
      try {
        await this.dispatchSubscription(sub.tenantId, sub);
        const next = computeNextRunAt(now, sub.cadence as Cadence);
        await this.db.client.pEReportSubscription.update({
          where: { id: sub.id },
          data: { lastRunAt: now, nextRunAt: next, lastError: null },
        });
        dispatched++;
      } catch (err) {
        this.logger.error(`Subscription ${sub.id} dispatch failed: ${(err as Error).message}`);
        await this.db.client.pEReportSubscription.update({
          where: { id: sub.id },
          data: {
            lastError: (err as Error).message.slice(0, 500),
            // Schedule a retry on the same cadence; surface the error in lastError.
            nextRunAt: computeNextRunAt(now, sub.cadence as Cadence),
          },
        });
        failed++;
      }
    }

    return { dispatched, failed, scanned: due.length };
  }

  /**
   * Render + deliver a single subscription. Routed by reportType:
   *  - 'digest' → CHRO daily digest (text summary + email + optional Slack)
   *  - everything else → file artifact attached to email
   */
  private async dispatchSubscription(
    tenantId: string,
    sub: {
      id: string;
      reportType: string;
      recipients: string[];
      slackWebhook: string | null;
    },
  ) {
    if (sub.reportType === 'digest') {
      const digest = await this.composeDigest(tenantId);
      if (sub.recipients.length > 0) {
        for (const r of sub.recipients) {
          await this.email.send({
            to: r,
            subject: digest.subject,
            html: digest.html,
            text: digest.text,
          });
        }
      }
      if (sub.slackWebhook) {
        await postToSlack(sub.slackWebhook, digest.slackText);
      }
      await this.db.forTenant(tenantId, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId,
            action: 'PAY_EQUITY_DIGEST_SENT',
            entityType: 'PEReportSubscription',
            entityId: sub.id,
            changes: {
              recipientCount: sub.recipients.length,
              hasSlack: !!sub.slackWebhook,
            } as unknown as Prisma.InputJsonValue,
          },
        }),
      );
      return;
    }

    // Report types: pull latest narrative run, generate artifact, email it.
    const latest = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.findFirst({
        where: { tenantId, agentType: 'narrative', status: 'COMPLETE' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    );
    if (!latest) {
      throw new Error('No completed narrative runs to dispatch');
    }
    const artifact = await this.pe.generateReport(
      tenantId,
      latest.id,
      sub.reportType as ReportType,
      'system-cron',
    );

    for (const to of sub.recipients) {
      await this.email.send({
        to,
        subject: `[Pay Equity] ${sub.reportType.replace('_', ' ').toUpperCase()} — ${new Date().toISOString().slice(0, 10)}`,
        html: `<p>Latest Pay Equity ${sub.reportType} report attached.</p><p>Run: <code>${latest.id}</code></p>`,
        text: `Latest Pay Equity ${sub.reportType} report attached. Run: ${latest.id}`,
        attachments: [
          { filename: artifact.filename, content: artifact.buffer, contentType: artifact.mimeType },
        ],
      });
    }

    await this.db.forTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          action: 'PAY_EQUITY_REPORT_DELIVERED',
          entityType: 'PEReportSubscription',
          entityId: sub.id,
          changes: {
            reportType: sub.reportType,
            recipientCount: sub.recipients.length,
            runId: latest.id,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    );
  }

  /**
   * Compose the CHRO digest content from the latest run + recent activity.
   * Returns email html/text + a short Slack-friendly text.
   */
  private async composeDigest(
    tenantId: string,
  ): Promise<{ subject: string; html: string; text: string; slackText: string }> {
    const overview = await this.pe.getOverview(tenantId);
    if (!overview.hasData) {
      const text = 'Pay Equity digest: no completed runs yet. Run an analysis to get started.';
      return {
        subject: '[Pay Equity] Daily digest',
        html: `<p>${text}</p>`,
        text,
        slackText: ':warning: ' + text,
      };
    }
    const o = overview;
    const date = new Date().toISOString().slice(0, 10);
    const subject = `[Pay Equity] Daily digest — ${date}`;
    const lines = [
      `Worst-cohort gap: ${o.worstGapPercent?.toFixed(1) ?? '—'}% (${o.worstCohort ?? '—'})`,
      `Significant gaps: ${o.significantCount ?? 0}`,
      `Sample: ${o.totalEmployees ?? 0} employees · confidence ${o.confidence ?? '—'}`,
      `Methodology: ${o.methodology ?? '—'}`,
    ];
    if (o.delta) {
      lines.push(
        `Δ vs last run: gap ${o.delta.worstGapPercentDelta >= 0 ? '+' : ''}${o.delta.worstGapPercentDelta.toFixed(2)}pp · significant ${o.delta.significantCountDelta >= 0 ? '+' : ''}${o.delta.significantCountDelta}`,
      );
    }
    const text = lines.join('\n');
    const html = `<h3>Pay Equity — ${date}</h3><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
    const slackText = `:bar_chart: *Pay Equity digest — ${date}*\n${lines.map((l) => `• ${l}`).join('\n')}`;
    return { subject, html, text, slackText };
  }

  // ─── Share tokens (5.5) ─────────────────────────────────────────

  async listShareTokens(tenantId: string) {
    return this.db.forTenant(tenantId, (tx) =>
      tx.pEShareToken.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async createShareToken(
    tenantId: string,
    userId: string,
    input: { runId: string; scope: string; expiresInDays?: number },
  ) {
    if (!VALID_SHARE_SCOPES.includes(input.scope as ShareScope)) {
      throw new BadRequestException(
        `Unknown scope: ${input.scope}. Valid: ${VALID_SHARE_SCOPES.join(', ')}`,
      );
    }
    // Confirm the run belongs to this tenant.
    await this.pe.getRun(tenantId, input.runId);

    const days = input.expiresInDays ?? 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const token = randomBytes(24).toString('base64url');

    const row = await this.db.forTenant(tenantId, (tx) =>
      tx.pEShareToken.create({
        data: {
          tenantId,
          runId: input.runId,
          token,
          scope: input.scope,
          expiresAt,
          createdById: userId,
        },
      }),
    );

    await this.db.forTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'PAY_EQUITY_SHARE_TOKEN_CREATED',
          entityType: 'PEShareToken',
          entityId: row.id,
          changes: {
            runId: input.runId,
            scope: input.scope,
            expiresAt: expiresAt.toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    );

    return row;
  }

  async revokeShareToken(tenantId: string, tokenId: string, userId: string) {
    const row = await this.db.forTenant(tenantId, (tx) =>
      tx.pEShareToken.findFirst({ where: { id: tokenId, tenantId } }),
    );
    if (!row) throw new NotFoundException(`Share token ${tokenId} not found`);

    await this.db.forTenant(tenantId, async (tx) => {
      await tx.pEShareToken.update({
        where: { id: tokenId },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'PAY_EQUITY_SHARE_TOKEN_REVOKED',
          entityType: 'PEShareToken',
          entityId: tokenId,
          changes: { runId: row.runId } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return { revoked: true };
  }

  /**
   * Public endpoint: redeem a share token and return the artifact.
   * No tenant auth required — the token is the credential. We update
   * accessCount + lastAccessedAt for audit.
   */
  async resolveShareToken(token: string): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }> {
    const row = await this.db.client.pEShareToken.findUnique({ where: { token } });
    if (!row) throw new NotFoundException('Share token not found');
    if (row.revokedAt) throw new BadRequestException('Share token has been revoked');
    if (row.expiresAt < new Date()) throw new BadRequestException('Share token has expired');

    await this.db.client.pEShareToken.update({
      where: { id: row.id },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    });

    // Map scope → report type. 'methodology' is served as the auditor PDF
    // since methodology is included in the auditor export.
    const reportType: ReportType = row.scope === 'defensibility' ? 'defensibility' : 'auditor';

    return this.pe.generateReport(row.tenantId, row.runId, reportType, 'share-token');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function computeNextRunAt(from: Date, cadence: Cadence): Date {
  const ms =
    cadence === 'daily'
      ? 24 * 60 * 60 * 1000
      : cadence === 'weekly'
        ? 7 * 24 * 60 * 60 * 1000
        : cadence === 'monthly'
          ? 30 * 24 * 60 * 60 * 1000
          : /* quarterly */ 91 * 24 * 60 * 60 * 1000;
  return new Date(from.getTime() + ms);
}

async function postToSlack(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

// Used by tests + service callers to verify the renderer invariants without
// re-running the full pipeline. Re-exported from a single point of truth.
export { renderReport };
export type { PayEquityAgentResult, PayEquityReport };
