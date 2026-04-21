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

  async getLetterPdf(tenantId: string, letterId: string): Promise<Buffer> {
    const letter = await this.getLetterById(tenantId, letterId);
    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const companyName = tenant?.name ?? 'Company';

    const content = letter.content ?? '';
    const isHtml = content.includes('<div') || content.includes('<p');
    const { paragraphs, tables, ceoQuote } = isHtml
      ? this.htmlToText(content)
      : {
          paragraphs: content
            .split(/\n\n+/)
            .map((p: string) => p.trim())
            .filter(Boolean),
          tables: [],
          ceoQuote: undefined,
        };

    const emp = letter.employee as {
      firstName?: string;
      lastName?: string;
      department?: string;
    } | null;

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const ACCENT = '#4f46e5';
      const GRAY = '#666666';
      const LIGHT_GRAY = '#e5e5e5';

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

      // ─── Date ────────────────────────────────
      doc.fontSize(10).font('Helvetica').fillColor(GRAY);
      doc.text(
        letter.generatedAt
          ? new Date(letter.generatedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
      );
      doc.moveDown(0.8);

      // ─── Subject ─────────────────────────────
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a1a');
      doc.text(letter.subject ?? 'Compensation Letter');
      doc.moveDown(0.3);
      if (emp) {
        doc.fontSize(10).font('Helvetica').fillColor(GRAY);
        doc.text(
          `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() +
            (emp.department ? ` · ${emp.department}` : ''),
        );
      }
      doc.moveDown(1);

      // ─── Body paragraphs ─────────────────────
      doc.fontSize(11).font('Helvetica').fillColor('#1a1a1a');
      for (const para of paragraphs) {
        doc.text(para, { align: 'left', lineGap: 3 });
        doc.moveDown(0.7);
      }

      // ─── Tables ──────────────────────────────
      for (const table of tables) {
        doc.moveDown(0.5);
        const colWidth = (535 - 60) / Math.max(table.headers.length, 1);
        // Header row
        if (table.headers.length > 0) {
          doc.rect(60, doc.y, 535 - 60, 24).fill(ACCENT);
          let hx = 60;
          for (const h of table.headers) {
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
            doc.text(h, hx + 8, doc.y - 18, {
              width: colWidth - 16,
              align: h.includes('Amount') || h.includes('USD') ? 'right' : 'left',
            });
            hx += colWidth;
          }
          doc.moveDown(0.3);
        }
        // Data rows
        for (const row of table.rows) {
          const rowY = doc.y;
          doc.moveTo(60, rowY).lineTo(535, rowY).lineWidth(0.5).stroke(LIGHT_GRAY);
          let rx = 60;
          for (let i = 0; i < row.length; i++) {
            doc.fontSize(10).font('Helvetica').fillColor('#1a1a1a');
            doc.text(row[i]!, rx + 8, rowY + 4, {
              width: colWidth - 16,
              align: i > 0 ? 'right' : 'left',
            });
            rx += colWidth;
          }
          doc.moveDown(1.2);
        }
        doc.moveDown(0.5);
      }

      // ─── CEO Quote ───────────────────────────
      if (ceoQuote) {
        doc.moveDown(0.5);
        const quoteY = doc.y;
        doc.rect(60, quoteY, 3, 50).fill(ACCENT);
        doc.fontSize(11).font('Helvetica-Oblique').fillColor(ACCENT);
        doc.text(`"${ceoQuote}"`, 72, quoteY + 4, {
          width: 535 - 72 - 20,
          align: 'left',
          lineGap: 3,
        });
        doc.moveDown(1);
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
