import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { existsSync } from 'fs';
import { DatabaseService } from '../../database';
import {
  invokeLetterGenerator,
  type LetterEmployeeData,
  type LetterCompData,
  type LetterType,
} from '@compensation/ai';
import { LetterStatus, LetterType as PrismaLetterType, Prisma } from '@compensation/database';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
import { GenerateLetterDto, LetterTypeDto } from './dto/generate-letter.dto';
import { GenerateBatchLetterDto } from './dto/generate-batch-letter.dto';
import { UpdateLetterDto } from './dto/update-letter.dto';
import { ListLettersDto } from './dto/list-letters.dto';
import type { ApproveLetterDto, RejectLetterDto } from './dto/approve-letter.dto';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Hard ceiling on a single LLM generation call. */
const LLM_TIMEOUT_MS = 60_000;

/** Reaper interval — sweeps stuck GENERATING rows. */
const REAPER_INTERVAL_MS = 60_000;

/** A row in GENERATING longer than this is considered orphaned by a crashed worker. */
const STUCK_GENERATING_MS = 5 * 60_000;

/** Cap concurrent letters in a batch. Each letter = 1 LLM call. */
const BATCH_CONCURRENCY = 3;

/** Cap on a single PDF render. */
const PDF_TIMEOUT_MS = 20_000;

const CHROME_CANDIDATES = [
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
];

const LETTER_TYPE_MAP: Record<LetterTypeDto, { ai: LetterType; prisma: PrismaLetterType }> = {
  [LetterTypeDto.OFFER]: { ai: 'offer', prisma: PrismaLetterType.OFFER },
  [LetterTypeDto.RAISE]: { ai: 'raise', prisma: PrismaLetterType.RAISE },
  [LetterTypeDto.PROMOTION]: { ai: 'promotion', prisma: PrismaLetterType.PROMOTION },
  [LetterTypeDto.BONUS]: { ai: 'bonus', prisma: PrismaLetterType.BONUS },
  [LetterTypeDto.TOTAL_COMP_SUMMARY]: {
    ai: 'total_comp_summary',
    prisma: PrismaLetterType.TOTAL_COMP_SUMMARY,
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Escape user/LLM/tenant text for safe interpolation into HTML. */
function esc(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tenant-supplied logoUrl is rendered into <img src>. Allow only http(s) URLs. */
function safeLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

interface SignatureConfig {
  name: string;
  title: string;
  initialsForCursive: string;
}

function resolveSignature(tenant: { name: string; settings: Prisma.JsonValue }): SignatureConfig {
  const settings =
    tenant.settings && typeof tenant.settings === 'object' && !Array.isArray(tenant.settings)
      ? (tenant.settings as Record<string, unknown>)
      : {};
  const sig =
    settings['letterSignature'] && typeof settings['letterSignature'] === 'object'
      ? (settings['letterSignature'] as Record<string, unknown>)
      : {};
  const name = typeof sig['name'] === 'string' && sig['name'].trim() ? sig['name'].trim() : '';
  const title = typeof sig['title'] === 'string' && sig['title'].trim() ? sig['title'].trim() : '';
  return {
    name: name || `${tenant.name} HR Team`,
    title: title || 'People & Compensation',
    initialsForCursive: (name || tenant.name).slice(0, 40),
  };
}

interface StructuredLetter {
  paragraphs: string[];
  compensation: Array<{ label: string; value: string }>;
  ceoQuote: string;
  subject?: string;
}

function parseStructured(raw: string): StructuredLetter | null {
  try {
    const cleaned = raw
      .replace(/```json?\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<StructuredLetter>;
    if (!Array.isArray(parsed.paragraphs)) return null;
    return {
      paragraphs: parsed.paragraphs.filter((p): p is string => typeof p === 'string'),
      compensation: Array.isArray(parsed.compensation)
        ? parsed.compensation
            .filter(
              (c): c is { label: string; value: string } =>
                typeof c === 'object' &&
                c !== null &&
                typeof (c as { label?: unknown }).label === 'string' &&
                typeof (c as { value?: unknown }).value === 'string',
            )
            .map((c) => ({ label: c.label, value: c.value }))
        : [],
      ceoQuote: typeof parsed.ceoQuote === 'string' ? parsed.ceoQuote : '',
      subject: typeof parsed.subject === 'string' ? parsed.subject : undefined,
    };
  } catch {
    return null;
  }
}

// ─── Approval state helpers ─────────────────────────────────────────────────

interface ApprovalChainStep {
  role: string;
  label: string;
}

interface ApprovalDecision {
  stepIndex: number;
  role: string;
  decidedBy: string;
  decidedByName: string;
  decision: 'APPROVED' | 'REJECTED';
  comment?: string;
  decidedAt: string;
}

interface ApprovalState {
  chain: ApprovalChainStep[];
  currentStep: number;
  decisions: ApprovalDecision[];
  rejected: boolean;
  submittedBy?: string;
  submittedAt?: string;
}

function readApprovalChain(settings: Prisma.JsonValue): ApprovalChainStep[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const raw = (settings as Record<string, unknown>)['letterApprovalChain'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is { role: string; label: string } =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as { role?: unknown }).role === 'string' &&
        typeof (s as { label?: unknown }).label === 'string',
    )
    .map((s) => ({ role: s.role, label: s.label }));
}

function readApprovalState(metadata: Prisma.JsonValue): ApprovalState | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>)['approval'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;

  const chain = Array.isArray(a['chain'])
    ? (a['chain'] as unknown[]).filter(
        (s): s is ApprovalChainStep =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as { role?: unknown }).role === 'string' &&
          typeof (s as { label?: unknown }).label === 'string',
      )
    : [];

  const decisions = Array.isArray(a['decisions'])
    ? (a['decisions'] as unknown[]).filter(
        (d): d is ApprovalDecision =>
          typeof d === 'object' &&
          d !== null &&
          typeof (d as { stepIndex?: unknown }).stepIndex === 'number' &&
          typeof (d as { decidedBy?: unknown }).decidedBy === 'string' &&
          ((d as { decision?: unknown }).decision === 'APPROVED' ||
            (d as { decision?: unknown }).decision === 'REJECTED'),
      )
    : [];

  return {
    chain,
    currentStep: typeof a['currentStep'] === 'number' ? a['currentStep'] : 0,
    decisions,
    rejected: a['rejected'] === true,
    submittedBy: typeof a['submittedBy'] === 'string' ? a['submittedBy'] : undefined,
    submittedAt: typeof a['submittedAt'] === 'string' ? a['submittedAt'] : undefined,
  };
}

function mergeApprovalIntoMetadata(
  existing: Prisma.JsonValue,
  state: ApprovalState,
): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const merged = {
    ...base,
    approval: {
      chain: state.chain,
      currentStep: state.currentStep,
      decisions: state.decisions,
      rejected: state.rejected,
      ...(state.submittedBy ? { submittedBy: state.submittedBy } : {}),
      ...(state.submittedAt ? { submittedAt: state.submittedAt } : {}),
    },
  };
  return merged as unknown as Prisma.InputJsonValue;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class LettersService implements OnModuleInit {
  private readonly logger = new Logger(LettersService.name);
  private chromePathCache: string | null | undefined; // undefined = not resolved yet
  private reaperHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue('letters-batch') private readonly batchQueue: Queue,
  ) {}

  onModuleInit() {
    // Resolve Chrome path once at startup (no per-request fs probing).
    const envPath = process.env['PUPPETEER_EXECUTABLE_PATH'];
    if (envPath && existsSync(envPath)) {
      this.chromePathCache = envPath;
    } else {
      this.chromePathCache = CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;
    }
    if (!this.chromePathCache) {
      this.logger.warn('No Chrome/Chromium binary found — PDF rendering will use pdfkit fallback');
    }

    // Reaper for orphaned GENERATING rows from crashed workers.
    this.reaperHandle = setInterval(() => {
      void this.reapStuckRows();
    }, REAPER_INTERVAL_MS);
    // Allow process to exit even if reaper is scheduled.
    if (typeof this.reaperHandle.unref === 'function') this.reaperHandle.unref();
  }

  private async reapStuckRows() {
    try {
      const cutoff = new Date(Date.now() - STUCK_GENERATING_MS);
      const result = await this.db.client.compensationLetter.updateMany({
        where: { status: LetterStatus.GENERATING, createdAt: { lt: cutoff } },
        data: { status: LetterStatus.FAILED, errorMsg: 'Generation timed out (reaper)' },
      });
      if (result.count > 0) {
        this.logger.warn(`Reaper: marked ${result.count} stuck GENERATING letter(s) as FAILED`);
      }
    } catch (err) {
      this.logger.error('Reaper sweep failed', err);
    }
  }

  // ─── Generation ──────────────────────────────────────────────────────────

  async generateLetter(tenantId: string, userId: string, dto: GenerateLetterDto) {
    const employee = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findFirst({ where: { id: dto.employeeId, tenantId } }),
    );
    if (!employee) {
      throw new NotFoundException(`Employee ${dto.employeeId} not found`);
    }

    const employeeData: LetterEmployeeData = {
      firstName: employee.firstName,
      lastName: employee.lastName,
      department: employee.department,
      level: employee.level,
      location: employee.location ?? undefined,
      hireDate: employee.hireDate?.toISOString(),
      currentSalary: Number(employee.baseSalary),
      currency: employee.currency,
    };

    const compData: LetterCompData = {
      letterType: LETTER_TYPE_MAP[dto.letterType].ai,
      newSalary: dto.newSalary,
      salaryIncrease: dto.salaryIncrease,
      salaryIncreasePercent: dto.salaryIncreasePercent,
      bonusAmount: dto.bonusAmount,
      newTitle: dto.newTitle,
      newLevel: dto.newLevel,
      effectiveDate: dto.effectiveDate,
      totalComp: dto.totalComp,
      benefits: dto.benefits,
      additionalNotes: dto.additionalNotes,
    };

    const letter = await this.db.forTenant(tenantId, (tx) =>
      tx.compensationLetter.create({
        data: {
          tenantId,
          userId,
          employeeId: dto.employeeId,
          letterType: LETTER_TYPE_MAP[dto.letterType].prisma,
          status: LetterStatus.GENERATING,
          subject: `${dto.letterType} letter - ${employee.firstName} ${employee.lastName}`,
          content: '',
          compData: compData as unknown as Prisma.InputJsonValue,
          tone: dto.tone ?? 'professional',
          language: dto.language ?? 'en',
        },
      }),
    );

    try {
      const result = await withTimeout(
        invokeLetterGenerator({
          tenantId,
          userId,
          employee: employeeData,
          compData,
          tone: dto.tone,
          language: dto.language,
          customInstructions: dto.customInstructions,
        }),
        LLM_TIMEOUT_MS,
        'letter LLM call',
      );

      const structured = parseStructured(result.content);
      if (!structured || structured.paragraphs.length === 0) {
        throw new Error('LLM returned malformed content (no paragraphs)');
      }

      const tenant = await this.db.forTenant(tenantId, (tx) =>
        tx.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, logoUrl: true, settings: true },
        }),
      );

      const finalContent = this.renderLetterHtml({
        structured,
        tenant: tenant ?? { name: 'Company', logoUrl: null, settings: {} },
        firstName: employee.firstName,
      });

      // Persist both the rendered HTML (for backward-compat readers) AND the
      // structured JSON in metadata, so we can re-render with new themes later.
      const metadata: Prisma.InputJsonValue = {
        structured: structured as unknown as Prisma.InputJsonValue,
        renderedAt: new Date().toISOString(),
      };

      return this.db.forTenant(tenantId, (tx) =>
        tx.compensationLetter.update({
          where: { id: letter.id },
          data: {
            subject: result.subject,
            content: finalContent,
            metadata,
            status: LetterStatus.REVIEW,
            generatedAt: new Date(),
          },
          include: {
            employee: {
              select: { firstName: true, lastName: true, department: true, email: true },
            },
          },
        }),
      );
    } catch (error) {
      this.logger.error(`Letter generation failed for ${letter.id}`, error);
      await this.db.forTenant(tenantId, (tx) =>
        tx.compensationLetter.update({
          where: { id: letter.id },
          data: {
            status: LetterStatus.FAILED,
            errorMsg: error instanceof Error ? error.message : 'Generation failed',
          },
        }),
      );
      throw error;
    }
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  /**
   * Render structured letter data to HTML. ALL interpolated text is escaped —
   * `structured` comes from the LLM, `tenant` fields come from tenant config;
   * neither is trusted.
   */
  private renderLetterHtml(input: {
    structured: StructuredLetter;
    tenant: { name: string; logoUrl: string | null; settings: Prisma.JsonValue };
    firstName: string;
  }): string {
    const { structured, tenant, firstName } = input;
    const companyName = tenant.name || 'Company';
    const logo = safeLogoUrl(tenant.logoUrl);
    const sig = resolveSignature(tenant);

    const logoHtml = logo
      ? `<img src="${esc(logo)}" alt="${esc(companyName)}" style="max-height:44px" />`
      : `<span style="font-size:26px;font-weight:800;color:white;letter-spacing:-0.5px">${esc(companyName)}</span>`;

    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const paragraphsHtml = structured.paragraphs
      .slice(0, 4)
      .map(
        (p) =>
          `<p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 14px">${esc(p)}</p>`,
      )
      .join('');

    const compHtml =
      structured.compensation.length > 0
        ? `
    <div style="background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%);border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin:24px 0">
      <p style="margin:0 0 12px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px">Compensation Summary</p>
      ${structured.compensation
        .map(
          (c) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #e2e8f0">
        <span style="color:#64748b;font-size:14px">${esc(c.label)}</span>
        <span style="font-weight:700;color:#1e293b;font-size:15px">${esc(c.value)}</span>
      </div>`,
        )
        .join('')}
    </div>`
        : '';

    const quoteHtml = structured.ceoQuote
      ? `
    <div style="background:linear-gradient(135deg,#eef2ff 0%,#f5f3ff 100%);border-left:4px solid #4f46e5;border-radius:0 10px 10px 0;padding:20px;margin:24px 0">
      <p style="margin:0;font-style:italic;color:#4338ca;font-size:14px;line-height:1.7">&ldquo;${esc(structured.ceoQuote)}&rdquo;</p>
      <p style="margin:10px 0 0;font-size:12px;color:#6366f1;font-weight:600">— ${esc(sig.name)}, ${esc(sig.title)}</p>
    </div>`
      : '';

    return `
<div style="max-width:640px;margin:0 auto;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#1e293b">
  <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="color:white;margin-bottom:8px">${logoHtml}</div>
    <p style="margin:0;color:rgba(255,255,255,0.7);font-size:10px;letter-spacing:3px;text-transform:uppercase">CONFIDENTIAL</p>
  </div>

  <div style="padding:32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;background:#ffffff">
    <p style="color:#94a3b8;font-size:12px;margin:0 0 20px">${esc(dateStr)}</p>
    <p style="font-size:15px;color:#334155;line-height:1.7;margin:0 0 16px">Dear ${esc(firstName)},</p>
    ${paragraphsHtml}
    ${compHtml}
    ${quoteHtml}
    <p style="color:#475569;font-size:14px;margin:24px 0 0">Warm regards,</p>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-family:cursive;font-size:24px;color:#4f46e5">${esc(sig.initialsForCursive)}</p>
      <p style="margin:4px 0 0;font-weight:700;font-size:13px;color:#1e293b">${esc(sig.name)}</p>
      <p style="margin:0;color:#94a3b8;font-size:11px">${esc(sig.title)}</p>
    </div>
  </div>

  <div style="text-align:center;padding:16px 0">
    <p style="margin:0;font-size:9px;color:#cbd5e1">Generated by CompportIQ · Confidential</p>
  </div>
</div>`;
  }

  // ─── Batch ───────────────────────────────────────────────────────────────

  /**
   * Enqueue a batch generation job and return immediately. The actual work
   * runs in a BullMQ worker (LettersBatchProcessor → runBatchJob). Callers
   * poll getBatchProgress(batchId) to track completion.
   */
  async enqueueBatch(tenantId: string, userId: string, dto: GenerateBatchLetterDto) {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const job = await this.batchQueue.add(
      'generate-letters',
      { tenantId, userId, batchId, dto },
      { jobId: batchId },
    );

    this.logger.log(
      `Enqueued batch ${batchId} (job=${job.id}) for ${dto.employeeIds.length} employees, tenant=${tenantId}`,
    );

    return {
      batchId,
      jobId: job.id,
      total: dto.employeeIds.length,
      status: 'queued' as const,
    };
  }

  /**
   * Worker entry point. Runs the batch with bounded concurrency, calling
   * onProgress after each letter so BullMQ can stream job.progress.
   */
  async runBatchJob(input: {
    tenantId: string;
    userId: string;
    batchId: string;
    dto: GenerateBatchLetterDto;
    onProgress?: (done: number, total: number) => void;
  }): Promise<{ batchId: string; total: number; succeeded: number; failed: number }> {
    const { tenantId, userId, batchId, dto, onProgress } = input;
    const queue = [...dto.employeeIds];
    const total = dto.employeeIds.length;
    let done = 0;
    let succeeded = 0;
    let failed = 0;

    const runOne = async (employeeId: string) => {
      try {
        const letterDto: GenerateLetterDto = {
          employeeId,
          letterType: dto.letterType,
          salaryIncreasePercent: dto.salaryIncreasePercent,
          bonusAmount: dto.bonusAmount,
          effectiveDate: dto.effectiveDate,
          tone: dto.tone,
          language: dto.language,
          additionalNotes: dto.additionalNotes,
        };
        const letter = await this.generateLetter(tenantId, userId, letterDto);
        await this.db.forTenant(tenantId, (tx) =>
          tx.compensationLetter.update({ where: { id: letter.id }, data: { batchId } }),
        );
        succeeded++;
      } catch (error) {
        this.logger.warn(
          `Batch ${batchId}: letter for employee=${employeeId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        failed++;
      } finally {
        done++;
        if (onProgress) onProgress(done, total);
      }
    };

    const worker = async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        await runOne(next);
      }
    };

    const workerCount = Math.max(1, Math.min(BATCH_CONCURRENCY, total));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return { batchId, total, succeeded, failed };
  }

  /**
   * Aggregate batch progress from CompensationLetter row counts plus the
   * BullMQ job state. Safe to poll — read-only and indexed by batchId.
   */
  async getBatchProgress(tenantId: string, batchId: string) {
    const [counts, job] = await Promise.all([
      this.db.forTenant(tenantId, (tx) =>
        tx.compensationLetter.groupBy({
          by: ['status'],
          where: { tenantId, batchId },
          _count: { _all: true },
        }),
      ),
      this.batchQueue.getJob(batchId).catch(() => null),
    ]);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of counts) {
      const n = row._count._all;
      byStatus[row.status] = n;
      total += n;
    }

    const expected = (job?.data as { dto?: { employeeIds?: string[] } } | undefined)?.dto
      ?.employeeIds?.length;
    const jobState = job ? await job.getState().catch(() => 'unknown') : 'not-found';
    const progress = typeof job?.progress === 'number' ? job.progress : 0;

    const succeeded =
      (byStatus[LetterStatus.REVIEW] ?? 0) +
      (byStatus[LetterStatus.APPROVED] ?? 0) +
      (byStatus[LetterStatus.SENT] ?? 0);
    const failed = byStatus[LetterStatus.FAILED] ?? 0;
    const inFlight = byStatus[LetterStatus.GENERATING] ?? 0;

    return {
      batchId,
      total: expected ?? total,
      seen: total,
      succeeded,
      failed,
      inFlight,
      byStatus,
      jobState,
      progress,
      done: jobState === 'completed' || jobState === 'failed',
    };
  }

  // ─── Read ────────────────────────────────────────────────────────────────

  async listLetters(tenantId: string, dto: ListLettersDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CompensationLetterWhereInput = { tenantId };
    if (dto.letterType) where.letterType = LETTER_TYPE_MAP[dto.letterType].prisma;
    if (dto.status) {
      const statusEnum = LetterStatus[dto.status as keyof typeof LetterStatus];
      if (statusEnum) where.status = statusEnum;
    }
    if (dto.employeeId) where.employeeId = dto.employeeId;
    if (dto.batchId) where.batchId = dto.batchId;
    if (dto.search) {
      // Search only the indexed-friendly fields (subject + employee name).
      // `content` may be very large HTML; full-text search there needs an FTS index.
      const term = dto.search.trim().slice(0, 200);
      if (term.length > 0) {
        where.OR = [
          { subject: { contains: term, mode: 'insensitive' } },
          { employee: { firstName: { contains: term, mode: 'insensitive' } } },
          { employee: { lastName: { contains: term, mode: 'insensitive' } } },
        ];
      }
    }

    const [items, total] = await this.db.forTenant(tenantId, async (tx) => {
      const i = await tx.compensationLetter.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: {
            select: { firstName: true, lastName: true, department: true, email: true },
          },
        },
      });
      const t = await tx.compensationLetter.count({ where });
      return [i, t] as const;
    });

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getLetterById(tenantId: string, letterId: string) {
    const letter = await this.db.forTenant(tenantId, (tx) =>
      tx.compensationLetter.findFirst({
        where: { id: letterId, tenantId },
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              department: true,
              email: true,
              level: true,
              location: true,
              baseSalary: true,
              totalComp: true,
              currency: true,
            },
          },
        },
      }),
    );
    if (!letter) throw new NotFoundException(`Letter ${letterId} not found`);
    return letter;
  }

  async updateLetter(tenantId: string, letterId: string, dto: UpdateLetterDto) {
    return this.db.forTenant(tenantId, async (tx) => {
      const letter = await tx.compensationLetter.findFirst({
        where: { id: letterId, tenantId },
      });
      if (!letter) throw new NotFoundException(`Letter ${letterId} not found`);

      const data: Prisma.CompensationLetterUpdateInput = {};
      if (dto.subject) data.subject = dto.subject;
      if (dto.content) data.content = dto.content;
      if (dto.status) {
        const statusEnum = LetterStatus[dto.status as keyof typeof LetterStatus];
        if (statusEnum) {
          data.status = statusEnum;
          if (statusEnum === LetterStatus.APPROVED) data.approvedAt = new Date();
          if (statusEnum === LetterStatus.SENT) data.sentAt = new Date();
        }
      }

      return tx.compensationLetter.update({
        where: { id: letterId },
        data,
        include: {
          employee: {
            select: { firstName: true, lastName: true, department: true, email: true },
          },
        },
      });
    });
  }

  // ─── Approval ────────────────────────────────────────────────────────────

  /**
   * Submit a letter for multi-step approval. Snapshots the tenant's current
   * approval chain into the letter's metadata so subsequent edits to the
   * tenant chain don't retroactively rewrite in-flight approvals.
   *
   * If the tenant has no chain configured, the letter is approved immediately
   * (degenerates to single-step approve). If the letter is in REVIEW from a
   * prior rejected attempt, this resets the approval state.
   */
  async submitForApproval(tenantId: string, userId: string, letterId: string) {
    const tenantChain = await this.readTenantApprovalChain(tenantId);
    return this.db.forTenant(tenantId, async (tx) => {
      const letter = await tx.compensationLetter.findFirst({
        where: { id: letterId, tenantId },
      });
      if (!letter) throw new NotFoundException(`Letter ${letterId} not found`);
      if (letter.status !== LetterStatus.REVIEW) {
        throw new BadRequestException(
          `Letter must be in REVIEW to submit for approval (current: ${letter.status})`,
        );
      }

      // Empty chain → approve immediately.
      if (tenantChain.length === 0) {
        const metadata = mergeApprovalIntoMetadata(letter.metadata, {
          chain: [],
          currentStep: 0,
          decisions: [
            {
              stepIndex: -1,
              role: '*',
              decidedBy: userId,
              decidedByName: 'self',
              decision: 'APPROVED',
              comment: 'No approval chain configured',
              decidedAt: new Date().toISOString(),
            },
          ],
          rejected: false,
          submittedBy: userId,
          submittedAt: new Date().toISOString(),
        });
        return tx.compensationLetter.update({
          where: { id: letterId },
          data: {
            status: LetterStatus.APPROVED,
            approvedAt: new Date(),
            metadata,
          },
          include: {
            employee: {
              select: { firstName: true, lastName: true, department: true, email: true },
            },
          },
        });
      }

      // Otherwise: snapshot the chain and start at step 0.
      const metadata = mergeApprovalIntoMetadata(letter.metadata, {
        chain: tenantChain,
        currentStep: 0,
        decisions: [],
        rejected: false,
        submittedBy: userId,
        submittedAt: new Date().toISOString(),
      });
      this.logger.log(`Submit for approval: letter=${letterId} chain=${tenantChain.length} steps`);
      return tx.compensationLetter.update({
        where: { id: letterId },
        data: { metadata },
        include: {
          employee: {
            select: { firstName: true, lastName: true, department: true, email: true },
          },
        },
      });
    });
  }

  /**
   * Approve the current step. The user's role must match the step's role
   * (case-insensitive). PLATFORM_ADMIN bypasses. The letter's author cannot
   * approve their own letter.
   */
  async approveStep(
    tenantId: string,
    approver: { userId: string; role: string; name?: string },
    letterId: string,
    dto: ApproveLetterDto,
  ) {
    return this.db.forTenant(tenantId, async (tx) => {
      const letter = await tx.compensationLetter.findFirst({
        where: { id: letterId, tenantId },
      });
      if (!letter) throw new NotFoundException(`Letter ${letterId} not found`);
      if (letter.status !== LetterStatus.REVIEW) {
        throw new BadRequestException(
          `Letter must be in REVIEW to approve (current: ${letter.status})`,
        );
      }
      if (letter.userId === approver.userId) {
        throw new ForbiddenException('You cannot approve your own letter');
      }

      const state = readApprovalState(letter.metadata);
      if (!state) {
        throw new BadRequestException(
          'Letter has not been submitted for approval — call /submit first',
        );
      }
      if (state.rejected) {
        throw new BadRequestException(
          'Letter was rejected — author must resubmit before further approvals',
        );
      }
      if (state.currentStep >= state.chain.length) {
        throw new BadRequestException('Approval chain is already complete');
      }

      const step = state.chain[state.currentStep]!;
      this.assertRoleMatch(approver.role, step.role);

      const decisions = [
        ...state.decisions,
        {
          stepIndex: state.currentStep,
          role: step.role,
          decidedBy: approver.userId,
          decidedByName: approver.name ?? approver.userId,
          decision: 'APPROVED' as const,
          comment: dto.comment?.trim() || undefined,
          decidedAt: new Date().toISOString(),
        },
      ];
      const nextStep = state.currentStep + 1;
      const finalApproval = nextStep >= state.chain.length;

      const metadata = mergeApprovalIntoMetadata(letter.metadata, {
        ...state,
        currentStep: nextStep,
        decisions,
      });

      this.logger.log(
        `Approve step ${state.currentStep + 1}/${state.chain.length}: letter=${letterId} approver=${approver.userId} role=${approver.role}`,
      );

      return tx.compensationLetter.update({
        where: { id: letterId },
        data: {
          metadata,
          ...(finalApproval ? { status: LetterStatus.APPROVED, approvedAt: new Date() } : {}),
        },
        include: {
          employee: {
            select: { firstName: true, lastName: true, department: true, email: true },
          },
        },
      });
    });
  }

  /**
   * Reject at the current step. Letter stays in REVIEW; metadata.approval.rejected
   * flips to true. The author must resubmit (via /submit) to reset the chain.
   */
  async rejectStep(
    tenantId: string,
    approver: { userId: string; role: string; name?: string },
    letterId: string,
    dto: RejectLetterDto,
  ) {
    return this.db.forTenant(tenantId, async (tx) => {
      const letter = await tx.compensationLetter.findFirst({
        where: { id: letterId, tenantId },
      });
      if (!letter) throw new NotFoundException(`Letter ${letterId} not found`);
      if (letter.status !== LetterStatus.REVIEW) {
        throw new BadRequestException(
          `Letter must be in REVIEW to reject (current: ${letter.status})`,
        );
      }
      if (letter.userId === approver.userId) {
        throw new ForbiddenException('You cannot reject your own letter');
      }

      const state = readApprovalState(letter.metadata);
      if (!state) {
        throw new BadRequestException('Letter has not been submitted for approval');
      }
      if (state.rejected) {
        throw new BadRequestException('Letter is already rejected');
      }
      if (state.currentStep >= state.chain.length) {
        throw new BadRequestException('Approval chain is already complete');
      }

      const step = state.chain[state.currentStep]!;
      this.assertRoleMatch(approver.role, step.role);

      const decisions = [
        ...state.decisions,
        {
          stepIndex: state.currentStep,
          role: step.role,
          decidedBy: approver.userId,
          decidedByName: approver.name ?? approver.userId,
          decision: 'REJECTED' as const,
          comment: dto.reason?.trim() || undefined,
          decidedAt: new Date().toISOString(),
        },
      ];

      const metadata = mergeApprovalIntoMetadata(letter.metadata, {
        ...state,
        decisions,
        rejected: true,
      });

      this.logger.warn(
        `Reject step ${state.currentStep + 1}/${state.chain.length}: letter=${letterId} approver=${approver.userId} reason=${dto.reason ?? ''}`,
      );

      return tx.compensationLetter.update({
        where: { id: letterId },
        data: { metadata },
        include: {
          employee: {
            select: { firstName: true, lastName: true, department: true, email: true },
          },
        },
      });
    });
  }

  private async readTenantApprovalChain(tenantId: string): Promise<ApprovalChainStep[]> {
    const tenant = await this.db.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
    return readApprovalChain(tenant.settings);
  }

  private assertRoleMatch(userRole: string, stepRole: string): void {
    if (userRole === 'PLATFORM_ADMIN') return;
    if (userRole.toLowerCase() === stepRole.toLowerCase()) return;
    throw new ForbiddenException(
      `Your role "${userRole}" cannot approve at this step (requires "${stepRole}")`,
    );
  }

  // ─── PDF ─────────────────────────────────────────────────────────────────

  async getLetterPdfWithName(
    tenantId: string,
    letterId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const letter = await this.getLetterById(tenantId, letterId);
    const buffer = await this.renderLetterPdf(tenantId, letter);
    const emp = letter.employee as { firstName?: string; lastName?: string } | null;
    const namePart = emp
      ? `${emp.firstName ?? ''}_${emp.lastName ?? ''}`.trim().replace(/\s+/g, '_')
      : 'letter';
    const safeName = namePart.replace(/[^A-Za-z0-9_-]/g, '') || 'letter';
    const type = (letter.letterType ?? 'letter').toLowerCase().replace(/_/g, '-');
    return { buffer, fileName: `${safeName}_${type}.pdf` };
  }

  /** @deprecated Prefer getLetterPdfWithName. Kept for callers that only need bytes. */
  async getLetterPdf(tenantId: string, letterId: string): Promise<Buffer> {
    const letter = await this.getLetterById(tenantId, letterId);
    return this.renderLetterPdf(tenantId, letter);
  }

  private async renderLetterPdf(
    tenantId: string,
    letter: {
      content: string | null;
      subject: string | null;
      metadata: Prisma.JsonValue | null;
      generatedAt: Date | null;
      letterType: PrismaLetterType;
      employee?: {
        firstName?: string | null;
        lastName?: string | null;
        department?: string | null;
      } | null;
    },
  ): Promise<Buffer> {
    const tenant = await this.db.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, logoUrl: true, settings: true },
      }),
    );

    // Re-render from structured JSON when available so the PDF reflects the
    // latest template, not whatever HTML happened to be stored.
    const structured = this.extractStructured(letter.metadata);
    let bodyHtml: string;
    if (structured) {
      bodyHtml = this.renderLetterHtml({
        structured,
        tenant: tenant ?? { name: 'Company', logoUrl: null, settings: {} },
        firstName: letter.employee?.firstName ?? '',
      });
    } else {
      // Legacy row without structured metadata — fall back to stored content.
      bodyHtml = letter.content ?? '';
    }

    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;background:#fff">${bodyHtml}</body></html>`;

    const chromePath = this.chromePathCache;
    if (chromePath) {
      try {
        return await this.renderWithPuppeteer(fullHtml, chromePath);
      } catch (err) {
        this.logger.warn(
          `Puppeteer render failed (${(err as Error).message}), using pdfkit fallback`,
        );
      }
    }

    return this.renderWithPdfKit(letter, tenant, structured);
  }

  private async renderWithPuppeteer(html: string, executablePath: string): Promise<Buffer> {
    const puppeteer = await import('puppeteer-core');
    const browser = await withTimeout(
      puppeteer.default.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
      }),
      PDF_TIMEOUT_MS,
      'puppeteer launch',
    );
    try {
      const page = await browser.newPage();
      await withTimeout(
        page.setContent(html, { waitUntil: 'domcontentloaded' }),
        PDF_TIMEOUT_MS,
        'puppeteer setContent',
      );
      const pdfUint8 = await withTimeout(
        page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '16px', bottom: '16px', left: '16px', right: '16px' },
        }),
        PDF_TIMEOUT_MS,
        'puppeteer pdf',
      );
      return Buffer.from(pdfUint8);
    } finally {
      try {
        await browser.close();
      } catch (closeErr) {
        this.logger.warn(`Failed to close puppeteer browser: ${(closeErr as Error).message}`);
      }
    }
  }

  private renderWithPdfKit(
    letter: {
      content: string | null;
      subject: string | null;
      generatedAt: Date | null;
      employee?: {
        firstName?: string | null;
        lastName?: string | null;
        department?: string | null;
      } | null;
    },
    tenant: { name: string; logoUrl: string | null; settings: Prisma.JsonValue } | null,
    structured: StructuredLetter | null,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const ACCENT = '#4f46e5';
      const GRAY = '#666666';
      const LIGHT_GRAY = '#e5e5e5';
      const companyName = tenant?.name ?? 'Company';
      const sig = resolveSignature(tenant ?? { name: companyName, settings: {} });
      const dateStr = (letter.generatedAt ?? new Date()).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const empName =
        `${letter.employee?.firstName ?? ''} ${letter.employee?.lastName ?? ''}`.trim();
      const empDept = letter.employee?.department ?? '';

      // Header
      doc
        .fontSize(24)
        .font('Helvetica-Bold')
        .fillColor(ACCENT)
        .text(companyName, { align: 'center' });
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor(ACCENT)
        .text('CONFIDENTIAL', { align: 'center', characterSpacing: 3 });
      doc.moveDown(0.3);
      doc.moveTo(60, doc.y).lineTo(535, doc.y).lineWidth(2).stroke(ACCENT);
      doc.moveDown(1.2);

      doc.fontSize(10).font('Helvetica').fillColor(GRAY).text(dateStr);
      doc.moveDown(0.8);
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor('#1a1a1a')
        .text(letter.subject ?? 'Compensation Letter');
      doc.moveDown(0.3);
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor(GRAY)
        .text(`${empName}${empDept ? ' · ' + empDept : ''}`);
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica').fillColor('#1a1a1a');
      const paragraphs: string[] = structured
        ? structured.paragraphs
        : (letter.content ?? '')
            .replace(/<[^>]+>/g, '')
            .split(/\n\n+/)
            .map((p) => p.trim())
            .filter(Boolean);

      for (const para of paragraphs) {
        doc.text(para, { align: 'left', lineGap: 3 });
        doc.moveDown(0.7);
      }

      if (structured && structured.compensation.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY).text('COMPENSATION SUMMARY');
        doc.moveDown(0.3);
        for (const c of structured.compensation) {
          doc.fontSize(10).font('Helvetica').fillColor('#1a1a1a').text(`${c.label}: ${c.value}`);
        }
        doc.moveDown(0.5);
      }

      if (structured?.ceoQuote) {
        doc.moveDown(0.5);
        doc
          .fontSize(10)
          .font('Helvetica-Oblique')
          .fillColor(ACCENT)
          .text(`"${structured.ceoQuote}"`, { align: 'left' });
        doc.moveDown(0.5);
      }

      // Signature
      doc.moveDown(2);
      doc.moveTo(60, doc.y).lineTo(535, doc.y).lineWidth(0.5).stroke(LIGHT_GRAY);
      doc.moveDown(0.5);
      doc.fontSize(18).font('Helvetica-Oblique').fillColor(ACCENT).text(sig.initialsForCursive);
      doc.moveDown(0.2);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a1a').text(sig.name);
      doc.fontSize(9).font('Helvetica').fillColor(GRAY).text(sig.title);

      doc.moveDown(3);
      doc.fontSize(7).fillColor('#cccccc').text('Generated by CompportIQ', { align: 'center' });

      doc.end();
    });
  }

  private extractStructured(metadata: Prisma.JsonValue | null): StructuredLetter | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const m = metadata as Record<string, unknown>;
    const s = m['structured'];
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const raw = JSON.stringify(s);
    return parseStructured(raw);
  }
}
