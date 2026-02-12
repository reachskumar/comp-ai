import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DatabaseService } from '../../database';
import {
  analyzeFile,
  parseCSV,
  cleanData,
  type AnalysisReport,
  type CleaningResult,
} from '@compensation/shared';
import type { ImportQueryDto } from './dto/import-query.dto';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const LARGE_FILE_THRESHOLD = 10_000; // rows

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue('import-processing') private readonly importQueue: Queue,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────

  private uploadDir(tenantId: string, jobId: string): string {
    return path.join(UPLOAD_ROOT, tenantId, jobId);
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  private async readFileBuffer(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
  }

  // ─── Upload ───────────────────────────────────────────────

  async upload(
    tenantId: string,
    userId: string,
    fileName: string,
    fileBuffer: Buffer,
  ) {
    // Create import job record
    const job = await this.db.client.importJob.create({
      data: {
        tenantId,
        userId,
        fileName,
        fileSize: fileBuffer.length,
        status: 'PENDING',
        settings: {},
      },
    });

    // Save file to disk
    const dir = this.uploadDir(tenantId, job.id);
    await this.ensureDir(dir);
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, fileBuffer);

    // Quick row count to decide sync vs async
    const text = fileBuffer.toString('utf-8');
    const { rows } = parseCSV(text);
    const totalRows = rows.length;

    await this.db.client.importJob.update({
      where: { id: job.id },
      data: { totalRows },
    });

    if (totalRows > LARGE_FILE_THRESHOLD) {
      // Queue for async processing
      await this.importQueue.add('analyze', { importJobId: job.id });
      this.logger.log(`Queued async analysis for job ${job.id} (${totalRows} rows)`);
      return {
        id: job.id,
        status: 'PENDING',
        fileName,
        totalRows,
      };
    }

    // Synchronous analysis for small files
    const analysis = await this.runAnalysis(job.id, tenantId);
    return {
      id: job.id,
      status: 'REVIEW',
      fileName,
      totalRows,
      analysis,
    };
  }

  // ─── Analysis ─────────────────────────────────────────────

  async runAnalysis(jobId: string, tenantId: string): Promise<AnalysisReport> {
    const job = await this.findJob(jobId, tenantId);

    await this.db.client.importJob.update({
      where: { id: jobId },
      data: { status: 'ANALYZING' },
    });

    const filePath = path.join(this.uploadDir(tenantId, jobId), job.fileName);
    const buffer = await this.readFileBuffer(filePath);
    const analysis = analyzeFile(buffer);

    // Store issues in DB
    if (analysis.issues.length > 0) {
      await this.db.client.importIssue.createMany({
        data: analysis.issues.map((issue) => ({
          importJobId: jobId,
          row: issue.row,
          column: issue.column,
          fieldName: analysis.fieldReports[issue.column]?.columnName ?? `Column ${issue.column}`,
          issueType: issue.type,
          severity: issue.severity,
          originalValue: issue.originalValue,
          cleanedValue: issue.suggestedFix || null,
        })),
      });
    }

    await this.db.client.importJob.update({
      where: { id: jobId },
      data: {
        status: 'REVIEW',
        encoding: analysis.encoding.encoding,
        totalRows: analysis.fileInfo.totalRows,
      },
    });

    return analysis;
  }

  async getAnalysis(jobId: string, tenantId: string) {
    const job = await this.findJob(jobId, tenantId);

    // If not yet analyzed, run analysis now
    if (job.status === 'PENDING') {
      const analysis = await this.runAnalysis(jobId, tenantId);
      const issues = await this.db.client.importIssue.findMany({
        where: { importJobId: jobId },
      });
      return { analysis, issues };
    }

    // Return stored issues + re-analyze for the report
    const filePath = path.join(this.uploadDir(tenantId, jobId), job.fileName);
    const buffer = await this.readFileBuffer(filePath);
    const analysis = analyzeFile(buffer);
    const issues = await this.db.client.importIssue.findMany({
      where: { importJobId: jobId },
    });

    return { analysis, issues };
  }

  // ─── Clean ────────────────────────────────────────────────

  async clean(jobId: string, tenantId: string) {
    const job = await this.findJob(jobId, tenantId);

    await this.db.client.importJob.update({
      where: { id: jobId },
      data: { status: 'CLEANING' },
    });

    const filePath = path.join(this.uploadDir(tenantId, jobId), job.fileName);
    const buffer = await this.readFileBuffer(filePath);
    const text = buffer.toString('utf-8');
    const { headers, rows } = parseCSV(text);

    // Get analysis report
    const analysis = analyzeFile(buffer);

    // Run cleaning pipeline
    const result: CleaningResult = cleanData(rows, headers, analysis);

    // Save cleaned CSV
    const dir = this.uploadDir(tenantId, jobId);
    const cleanedCsv = this.rowsToCsv(result.headers, result.cleanedRows);
    await fs.writeFile(path.join(dir, 'cleaned.csv'), cleanedCsv, 'utf-8');

    // Save rejects CSV
    if (result.rejectedRows.length > 0) {
      const rejectHeaders = ['rowIndex', ...result.headers, 'rejectReasons'];
      const rejectData = result.rejectedRows.map((r) => [
        String(r.rowIndex),
        ...r.row,
        r.rejectReasons.join('; '),
      ]);
      const rejectsCsv = this.rowsToCsv(rejectHeaders, rejectData);
      await fs.writeFile(path.join(dir, 'rejects.csv'), rejectsCsv, 'utf-8');
    }

    // Store auto-fixed issues
    const autoFixedIssues = result.diffReport.map((diff) => ({
      importJobId: jobId,
      row: diff.row,
      column: diff.column,
      fieldName: diff.columnName,
      issueType: 'CUSTOM' as const,
      severity: 'INFO' as const,
      originalValue: diff.originalValue,
      cleanedValue: diff.cleanedValue,
      resolution: 'AUTO_FIXED' as const,
    }));

    if (autoFixedIssues.length > 0) {
      await this.db.client.importIssue.createMany({ data: autoFixedIssues });
    }

    // Update job
    await this.db.client.importJob.update({
      where: { id: jobId },
      data: {
        status: 'REVIEW',
        cleanRows: result.cleanedRows.length,
        rejectRows: result.rejectedRows.length,
      },
    });

    return {
      cleanedRows: result.cleanedRows.length,
      rejectedRows: result.rejectedRows.length,
      diffReport: result.diffReport,
      summary: result.summary,
    };
  }

  // ─── Approve ──────────────────────────────────────────────

  async approve(jobId: string, tenantId: string) {
    const job = await this.findJob(jobId, tenantId);

    if (job.status !== 'REVIEW') {
      throw new BadRequestException(`Import job must be in REVIEW status to approve. Current: ${job.status}`);
    }

    await this.db.client.importJob.update({
      where: { id: jobId },
      data: { status: 'APPROVED' },
    });

    // Read cleaned CSV
    const cleanedPath = path.join(this.uploadDir(tenantId, jobId), 'cleaned.csv');
    const cleanedText = await fs.readFile(cleanedPath, 'utf-8');
    const { headers, rows } = parseCSV(cleanedText);

    // Map headers to indices
    const headerMap = new Map<string, number>();
    headers.forEach((h, i) => headerMap.set(h.toLowerCase(), i));

    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const getValue = (key: string): string => {
        const idx = headerMap.get(key.toLowerCase());
        return idx !== undefined ? (row[idx] ?? '') : '';
      };

      const employeeCode = getValue('employeecode') || getValue('employee_code') || getValue('id');
      if (!employeeCode) continue;

      const data = {
        email: getValue('email') || `${employeeCode}@placeholder.com`,
        firstName: getValue('firstname') || getValue('first_name') || 'Unknown',
        lastName: getValue('lastname') || getValue('last_name') || 'Unknown',
        department: getValue('department') || 'Unassigned',
        level: getValue('level') || getValue('grade') || 'N/A',
        location: getValue('location') || null,
        hireDate: this.parseDate(getValue('hiredate') || getValue('hire_date')),
        currency: getValue('currency') || 'USD',
        baseSalary: parseFloat(getValue('basesalary') || getValue('base_salary') || '0') || 0,
        totalComp: parseFloat(getValue('totalcomp') || getValue('total_comp') || '0') || 0,
      };

      const existing = await this.db.client.employee.findUnique({
        where: { tenantId_employeeCode: { tenantId, employeeCode } },
      });

      if (existing) {
        await this.db.client.employee.update({
          where: { id: existing.id },
          data,
        });
        updated++;
      } else {
        await this.db.client.employee.create({
          data: { ...data, tenantId, employeeCode },
        });
        created++;
      }
    }

    await this.db.client.importJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    return { imported: created + updated, created, updated };
  }

  // ─── List / Get ───────────────────────────────────────────

  async list(tenantId: string, query: ImportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.status) {
      where['status'] = query.status;
    }

    const [data, total] = await Promise.all([
      this.db.client.importJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.client.importJob.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getById(jobId: string, tenantId: string) {
    const job = await this.findJob(jobId, tenantId);
    const issues = await this.db.client.importIssue.findMany({
      where: { importJobId: jobId },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
    return { ...job, issues };
  }

  // ─── Downloads ────────────────────────────────────────────

  async getCleanedFilePath(jobId: string, tenantId: string): Promise<string> {
    await this.findJob(jobId, tenantId);
    const filePath = path.join(this.uploadDir(tenantId, jobId), 'cleaned.csv');
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Cleaned file not found. Run cleaning first.');
    }
    return filePath;
  }

  async getRejectsFilePath(jobId: string, tenantId: string): Promise<string> {
    await this.findJob(jobId, tenantId);
    const filePath = path.join(this.uploadDir(tenantId, jobId), 'rejects.csv');
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Rejects file not found. Run cleaning first.');
    }
    return filePath;
  }

  // ─── Private Helpers ──────────────────────────────────────

  private async findJob(jobId: string, tenantId: string) {
    const job = await this.db.client.importJob.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }
    return job;
  }

  private rowsToCsv(headers: string[], rows: string[][]): string {
    const escape = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };
    const lines = [headers.map(escape).join(',')];
    for (const row of rows) {
      lines.push(row.map(escape).join(','));
    }
    return lines.join('\n');
  }

  private parseDate(value: string): Date {
    if (!value) return new Date();
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}

