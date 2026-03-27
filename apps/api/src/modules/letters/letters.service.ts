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

      // Update letter with generated content
      return this.db.forTenant(tenantId, (tx) =>
        tx.compensationLetter.update({
          where: { id: letter.id },
          data: {
            subject: result.subject,
            content: result.content,
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

  async getLetterPdf(tenantId: string, letterId: string): Promise<Buffer> {
    const letter = await this.getLetterById(tenantId, letterId);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ─── Header ──────────────────────────────
      doc.fontSize(20).font('Helvetica-Bold').text('Compport', { align: 'center' });
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#666666')
        .text(`Compensation Letter`, { align: 'center' });
      doc.moveDown(0.3);
      doc.moveTo(60, doc.y).lineTo(535, doc.y).stroke('#cccccc');
      doc.moveDown(1);

      // ─── Meta ────────────────────────────────
      doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold');
      doc.text(letter.subject ?? 'Compensation Letter');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      const emp = letter.employee as {
        firstName?: string;
        lastName?: string;
        department?: string;
      } | null;
      if (emp) {
        doc.text(`Employee: ${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim());
        if (emp.department) doc.text(`Department: ${emp.department}`);
      }
      doc.text(`Type: ${letter.letterType}`);
      if (letter.generatedAt) {
        doc.text(`Date: ${new Date(letter.generatedAt).toLocaleDateString()}`);
      }
      doc.moveDown(1);

      // ─── Body ────────────────────────────────
      doc.fontSize(11).font('Helvetica');
      const content = letter.content ?? '';
      // Split into paragraphs and render
      const paragraphs = content.split(/\n\n+/);
      for (const para of paragraphs) {
        doc.text(para.trim(), { align: 'left', lineGap: 4 });
        doc.moveDown(0.8);
      }

      // ─── Footer ──────────────────────────────
      doc.moveDown(2);
      doc.fontSize(8).fillColor('#999999').text('Generated by CompportIQ', { align: 'center' });

      doc.end();
    });
  }
}
