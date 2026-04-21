import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import {
  invokeLetterGenerator,
  type LetterEmployeeData,
  type LetterCompData,
  type LetterType,
} from '@compensation/ai';
import { Prisma } from '@compensation/database';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
import { GenerateLetterDto, LetterTypeDto } from './dto/generate-letter.dto';
import { GenerateBatchLetterDto } from './dto/generate-batch-letter.dto';
import { UpdateLetterDto } from './dto/update-letter.dto';
import { ListLettersDto } from './dto/list-letters.dto';

function mapLetterType(dto: LetterTypeDto): LetterType {
  const map: Record<LetterTypeDto, LetterType> = {
    [LetterTypeDto.OFFER]: 'offer',
    [LetterTypeDto.RAISE]: 'raise',
    [LetterTypeDto.PROMOTION]: 'promotion',
    [LetterTypeDto.BONUS]: 'bonus',
    [LetterTypeDto.TOTAL_COMP_SUMMARY]: 'total_comp_summary',
  };
  return map[dto];
}

function mapLetterTypeToEnum(dto: LetterTypeDto): string {
  const map: Record<LetterTypeDto, string> = {
    [LetterTypeDto.OFFER]: 'OFFER',
    [LetterTypeDto.RAISE]: 'RAISE',
    [LetterTypeDto.PROMOTION]: 'PROMOTION',
    [LetterTypeDto.BONUS]: 'BONUS',
    [LetterTypeDto.TOTAL_COMP_SUMMARY]: 'TOTAL_COMP_SUMMARY',
  };
  return map[dto];
}

@Injectable()
export class LettersService {
  private readonly logger = new Logger(LettersService.name);

  constructor(private readonly db: DatabaseService) {}

  async generateLetter(tenantId: string, userId: string, dto: GenerateLetterDto) {
    // Fetch employee data
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
      letterType: mapLetterType(dto.letterType),
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

    // Create letter record in GENERATING status
    const letter = await this.db.forTenant(tenantId, (tx) =>
      tx.compensationLetter.create({
        data: {
          tenantId,
          userId,
          employeeId: dto.employeeId,
          letterType: mapLetterTypeToEnum(dto.letterType) as never,
          status: 'GENERATING' as never,
          subject: `${dto.letterType} letter - ${employee.firstName} ${employee.lastName}`,
          content: '',
          compData: compData as unknown as Prisma.InputJsonValue,
          tone: dto.tone ?? 'professional',
          language: dto.language ?? 'en',
        },
      }),
    );

    // Generate letter asynchronously
    try {
      const result = await invokeLetterGenerator({
        tenantId,
        userId,
        employee: employeeData,
        compData,
        tone: dto.tone,
        language: dto.language,
        customInstructions: dto.customInstructions,
      });

      // Inject company logo into generated HTML
      const tenant = await this.db.client.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, logoUrl: true },
      });
      const logoHtml = tenant?.logoUrl
        ? `<img src="${tenant.logoUrl}" alt="${tenant.name}" style="max-height:48px;max-width:200px" />`
        : `<h1 style="margin:0;font-size:24px;color:#4f46e5;font-weight:bold">${tenant?.name ?? 'Company'}</h1>`;
      const finalContent = result.content.replace(/\{\{COMPANY_LOGO\}\}/g, logoHtml);

      // Update letter with generated content
      return this.db.forTenant(tenantId, (tx) =>
        tx.compensationLetter.update({
          where: { id: letter.id },
          data: {
            subject: result.subject,
            content: finalContent,
            status: 'REVIEW' as never,
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
            status: 'FAILED' as never,
            errorMsg: error instanceof Error ? error.message : 'Generation failed',
          },
        }),
      );
      throw error;
    }
  }

  async generateBatch(tenantId: string, userId: string, dto: GenerateBatchLetterDto) {
    const batchId = `batch-${Date.now()}`;
    const results = [];

    for (const employeeId of dto.employeeIds) {
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
        // Tag with batch ID
        await this.db.forTenant(tenantId, (tx) =>
          tx.compensationLetter.update({
            where: { id: letter.id },
            data: { batchId },
          }),
        );
        results.push({ employeeId, letterId: letter.id, status: 'success' });
      } catch (error) {
        results.push({
          employeeId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { batchId, total: dto.employeeIds.length, results };
  }

  async listLetters(tenantId: string, dto: ListLettersDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CompensationLetterWhereInput = { tenantId };
    if (dto.letterType) where.letterType = mapLetterTypeToEnum(dto.letterType) as never;
    if (dto.status) where.status = dto.status as never;
    if (dto.employeeId) where.employeeId = dto.employeeId;
    if (dto.batchId) where.batchId = dto.batchId;
    if (dto.search) {
      where.OR = [
        { subject: { contains: dto.search, mode: 'insensitive' } },
        { content: { contains: dto.search, mode: 'insensitive' } },
      ];
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
        data.status = dto.status as never;
        if (dto.status === 'APPROVED') data.approvedAt = new Date();
        if (dto.status === 'SENT') data.sentAt = new Date();
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

  /**
   * Strip HTML tags and extract clean text for PDF rendering.
   * Preserves paragraph breaks and extracts table data.
   */
  private htmlToText(html: string): {
    paragraphs: string[];
    tables: Array<{ headers: string[]; rows: string[][] }>;
    ceoQuote?: string;
  } {
    const paragraphs: string[] = [];
    const tables: Array<{ headers: string[]; rows: string[][] }> = [];
    let ceoQuote: string | undefined;

    // Extract blockquote (CEO message)
    const quoteMatch = html.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i);
    if (quoteMatch) {
      ceoQuote = quoteMatch[1]!
        .replace(/<[^>]+>/g, '')
        .replace(/&[a-z]+;/g, ' ')
        .trim();
    }

    // Extract tables
    const tableMatches = html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi);
    for (const tm of tableMatches) {
      const headers: string[] = [];
      const rows: string[][] = [];
      const thMatches = tm[1]!.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi);
      for (const th of thMatches) headers.push(th[1]!.replace(/<[^>]+>/g, '').trim());
      const trMatches = tm[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      let isFirst = true;
      for (const tr of trMatches) {
        if (isFirst && headers.length > 0) {
          isFirst = false;
          continue;
        } // skip header row
        isFirst = false;
        const cells: string[] = [];
        const tdMatches = tr[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        for (const td of tdMatches) cells.push(td[1]!.replace(/<[^>]+>/g, '').trim());
        if (cells.length > 0) rows.push(cells);
      }
      if (headers.length > 0 || rows.length > 0) tables.push({ headers, rows });
    }

    // Extract paragraphs (text between tags)
    const stripped = html
      .replace(/<table[\s\S]*?<\/table>/gi, '') // remove tables
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '') // remove quotes
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/CONFIDENTIAL/g, '');

    for (const p of stripped.split(/\n\n+/)) {
      const trimmed = p.trim();
      if (trimmed && trimmed.length > 1) paragraphs.push(trimmed);
    }

    return { paragraphs, tables, ceoQuote };
  }

  async getLetterPdfWithName(
    tenantId: string,
    letterId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const buffer = await this.getLetterPdf(tenantId, letterId);
    const letter = await this.getLetterById(tenantId, letterId);
    const emp = letter.employee as { firstName?: string; lastName?: string } | null;
    const name = emp
      ? `${emp.firstName ?? ''}_${emp.lastName ?? ''}`.trim().replace(/\s+/g, '_')
      : 'letter';
    const type = (letter.letterType ?? 'letter').toLowerCase().replace(/_/g, '-');
    return { buffer, fileName: `${name}_${type}.pdf` };
  }

  async getLetterPdf(tenantId: string, letterId: string): Promise<Buffer> {
    const letter = await this.getLetterById(tenantId, letterId);
    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, logoUrl: true },
    });
    const companyName = tenant?.name ?? 'Company';
    const logoHtml = tenant?.logoUrl
      ? `<img src="${tenant.logoUrl}" alt="${companyName}" style="max-height:48px" />`
      : `<h1 style="margin:0;font-size:28px;color:#4f46e5;font-weight:bold;font-family:Georgia,serif">${companyName}</h1>`;

    const content = letter.content ?? '';
    const emp = letter.employee as {
      firstName?: string;
      lastName?: string;
      department?: string;
    } | null;
    const empName = `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim();
    const empDept = emp?.department ?? '';
    const dateStr = letter.generatedAt
      ? new Date(letter.generatedAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const isHtml = content.includes('<div') || content.includes('<p');

    // Build HTML body for PDF
    let bodyHtml: string;
    if (isHtml) {
      bodyHtml = content.replace(/\{\{COMPANY_LOGO\}\}/g, logoHtml);
    } else {
      // Convert plain text to styled HTML
      const paragraphs = content
        .split(/\n\n+/)
        .map((p: string) => p.trim())
        .filter(Boolean);
      const bodyParts = paragraphs
        .map((p: string) => {
          if (p.startsWith('"') || p.startsWith('\u201c')) {
            return `<blockquote style="border-left:4px solid #4f46e5;padding:12px 16px;margin:20px 0;color:#4f46e5;font-style:italic;background:#f8f7ff;border-radius:0 8px 8px 0">${p}</blockquote>`;
          }
          if (p.match(/^(Base Salary|Bonus|RSU|Total|Equity|Benefits):/m)) {
            const lines = p
              .split('\n')
              .map((l: string) => l.trim())
              .filter(Boolean);
            return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0">${lines
              .map((l: string) => {
                const [label, ...vals] = l.split(':');
                return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0"><span style="color:#666">${label}</span><span style="font-weight:600">${vals.join(':').trim()}</span></div>`;
              })
              .join('')}</div>`;
          }
          return `<p style="margin:0 0 14px;line-height:1.7">${p}</p>`;
        })
        .join('');

      bodyHtml = `<div style="max-width:640px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
        <div style="text-align:center;padding:28px 0;border-bottom:2px solid #4f46e5">${logoHtml}
          <p style="margin:8px 0 0;color:#4f46e5;font-size:10px;letter-spacing:3px">CONFIDENTIAL</p></div>
        <div style="padding:28px 0">
          <p style="color:#999;font-size:12px;margin:0">${dateStr}</p>
          <h2 style="font-size:17px;margin:14px 0 4px">${letter.subject ?? 'Compensation Letter'}</h2>
          <p style="color:#888;font-size:13px;margin:0 0 24px">${empName}${empDept ? ' · ' + empDept : ''}</p>
          ${bodyParts}
          <div style="margin-top:36px;padding-top:16px;border-top:1px solid #e5e5e5">
            <p style="margin:0;font-family:cursive;font-size:22px;color:#4f46e5">Sachin Bajaj</p>
            <p style="margin:4px 0 0;font-weight:bold;font-size:13px">Sachin Bajaj</p>
            <p style="margin:0;color:#888;font-size:11px">Founder & CEO</p></div>
        </div>
        <div style="text-align:center;padding:12px 0;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:8px;color:#ccc">Generated by CompportIQ</p></div>
      </div>`;
    }

    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;background:#fff">${bodyHtml}</body></html>`;

    // Try Puppeteer first, fall back to pdfkit
    try {
      const puppeteer = await import('puppeteer-core');
      const { existsSync } = await import('fs');
      const execPath =
        process.env['PUPPETEER_EXECUTABLE_PATH'] ??
        ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(
          (p) => existsSync(p),
        );
      if (!execPath) throw new Error('No Chrome/Chromium found');

      const browser = await puppeteer.default.launch({
        headless: true,
        executablePath: execPath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--single-process',
        ],
      });
      const page = await browser.newPage();
      await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });
      const pdfUint8 = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16px', bottom: '16px', left: '16px', right: '16px' },
      });
      await browser.close();
      return Buffer.from(pdfUint8);
    } catch (err) {
      this.logger.warn(`Puppeteer unavailable (${(err as Error).message}), using pdfkit fallback`);
    }

    // ─── pdfkit fallback ─────────────────────────
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const ACCENT = '#4f46e5';
      const GRAY = '#666666';
      const LIGHT_GRAY = '#e5e5e5';
      const plainParagraphs = content
        .replace(/<[^>]+>/g, '')
        .split(/\n\n+/)
        .map((p: string) => p.trim())
        .filter(Boolean);

      // ─── Header ──────────────────────────────
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
      for (const para of plainParagraphs) {
        doc.text(para, { align: 'left', lineGap: 3 });
        doc.moveDown(0.7);
      }

      // ─── Signature ───────────────────────────
      doc.moveDown(2);
      doc.moveTo(60, doc.y).lineTo(535, doc.y).lineWidth(0.5).stroke(LIGHT_GRAY);
      doc.moveDown(0.5);
      // Stylized signature
      doc.fontSize(18).font('Helvetica-Oblique').fillColor(ACCENT).text('Sachin Bajaj');
      doc.moveDown(0.2);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a1a').text('Sachin Bajaj');
      doc.fontSize(9).font('Helvetica').fillColor(GRAY).text('Founder & CEO');

      // ─── Footer ──────────────────────────────
      doc.moveDown(3);
      doc.fontSize(7).fillColor('#cccccc').text('Generated by CompportIQ', { align: 'center' });

      doc.end();
    });
  }
}
