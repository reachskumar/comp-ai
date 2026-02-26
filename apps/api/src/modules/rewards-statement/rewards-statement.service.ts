import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'statements');

@Injectable()
export class RewardsStatementService {
  private readonly logger = new Logger(RewardsStatementService.name);

  constructor(private readonly db: DatabaseService) {}

  async generate(tenantId: string, employeeId: string, year?: number) {
    const currentYear = year ?? new Date().getFullYear();

    const employee = await this.db.client.employee.findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    // Get benefit enrollments
    const enrollments = await this.db.client.benefitEnrollment.findMany({
      where: { tenantId, employeeId: employee.id, status: 'ACTIVE' },
    });
    const benefitsValue = enrollments.reduce((sum, e) => sum + Number(e.employerPremium) * 12, 0);

    const baseSalary = Number(employee.baseSalary);
    const totalComp = Number(employee.totalComp);
    const bonusEstimate = Math.max(0, totalComp - baseSalary - benefitsValue);
    const totalRewardsValue = Math.round(baseSalary + bonusEstimate + benefitsValue);

    // Build breakdown
    const breakdown: Array<{ category: string; value: number }> = [
      { category: 'Base Salary', value: Math.round(baseSalary) },
    ];
    if (bonusEstimate > 0) {
      breakdown.push({ category: 'Bonus / Variable', value: Math.round(bonusEstimate) });
    }
    if (benefitsValue > 0) {
      breakdown.push({ category: 'Benefits', value: Math.round(benefitsValue) });
    }

    // Generate PDF
    const dir = path.join(UPLOAD_ROOT, tenantId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fileName = `statement-${employee.id}-${currentYear}.pdf`;
    const filePath = path.join(dir, fileName);
    const pdfUrl = `/uploads/statements/${tenantId}/${fileName}`;

    await this.generatePdf(filePath, {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      title: employee.level,
      department: employee.department,
      year: currentYear,
      breakdown,
      totalRewardsValue,
    });

    // Upsert statement record
    const existing = await this.db.client.rewardsStatement.findFirst({
      where: { tenantId, employeeId: employee.id, year: currentYear },
    });

    let statement;
    if (existing) {
      statement = await this.db.client.rewardsStatement.update({
        where: { id: existing.id },
        data: { pdfUrl, status: 'GENERATED', generatedAt: new Date() },
      });
    } else {
      statement = await this.db.client.rewardsStatement.create({
        data: {
          tenantId,
          employeeId: employee.id,
          year: currentYear,
          pdfUrl,
          status: 'GENERATED',
          config: { breakdown, totalRewardsValue },
        },
      });
    }

    this.logger.log(`Generated statement for employee=${employee.id} year=${currentYear}`);
    return statement;
  }

  async generateBulk(tenantId: string, department?: string, year?: number) {
    const where: Record<string, unknown> = { tenantId, terminationDate: null };
    if (department) where.department = department;

    const employees = await this.db.client.employee.findMany({ where: where as never });
    const results = [];

    for (const emp of employees) {
      try {
        const stmt = await this.generate(tenantId, emp.id, year);
        results.push({ employeeId: emp.id, status: 'success', statementId: stmt.id });
      } catch (err) {
        this.logger.error(`Failed to generate for employee=${emp.id}`, err);
        results.push({ employeeId: emp.id, status: 'failed', error: (err as Error).message });
      }
    }

    return {
      total: employees.length,
      generated: results.filter((r) => r.status === 'success').length,
      results,
    };
  }

  async list(
    tenantId: string,
    query: { status?: string; employeeId?: string; page?: string; limit?: string },
  ) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.employeeId) where.employeeId = query.employeeId;

    const [data, total] = await Promise.all([
      this.db.client.rewardsStatement.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { generatedAt: 'desc' },
        include: {
          employee: { select: { firstName: true, lastName: true, department: true, email: true } },
        },
      }),
      this.db.client.rewardsStatement.count({ where: where as never }),
    ]);

    return { data, total, page, limit };
  }

  async getById(tenantId: string, id: string) {
    const statement = await this.db.client.rewardsStatement.findFirst({
      where: { id, tenantId },
      include: {
        employee: { select: { firstName: true, lastName: true, department: true, email: true } },
      },
    });
    if (!statement) throw new NotFoundException('Statement not found');
    return statement;
  }

  async getMyStatement(tenantId: string, userId: string) {
    const user = await this.db.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const employee = await this.db.client.employee.findFirst({
      where: { tenantId, email: user.email },
    });
    if (!employee) return [];

    return this.db.client.rewardsStatement.findMany({
      where: { tenantId, employeeId: employee.id },
      orderBy: { year: 'desc' },
    });
  }

  async sendEmail(tenantId: string, id: string) {
    const statement = await this.db.client.rewardsStatement.findFirst({
      where: { id, tenantId },
      include: { employee: { select: { email: true, firstName: true, lastName: true } } },
    });
    if (!statement) throw new NotFoundException('Statement not found');

    const emailTo = statement.employee.email;
    this.logger.log(`Would send email to ${emailTo} for statement ${id}`);

    return this.db.client.rewardsStatement.update({
      where: { id },
      data: { emailSentAt: new Date(), emailTo, status: 'SENT' },
    });
  }

  async getDownloadPath(tenantId: string, id: string): Promise<string> {
    const statement = await this.db.client.rewardsStatement.findFirst({
      where: { id, tenantId },
    });
    if (!statement || !statement.pdfUrl) {
      throw new NotFoundException('Statement PDF not found');
    }
    const filePath = path.resolve(process.cwd(), statement.pdfUrl.replace(/^\//, ''));
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('PDF file not found on disk');
    }
    return filePath;
  }

  private async generatePdf(
    filePath: string,
    data: {
      employeeName: string;
      title: string;
      department: string;
      year: number;
      breakdown: Array<{ category: string; value: number }>;
      totalRewardsValue: number;
    },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Header
      doc.fontSize(24).font('Helvetica-Bold').text('Compport', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(16).font('Helvetica').text('Total Rewards Statement', { align: 'center' });
      doc.fontSize(12).text(`Year: ${data.year}`, { align: 'center' });
      doc.moveDown(1);

      // Divider
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      // Employee Info
      doc.fontSize(14).font('Helvetica-Bold').text('Employee Information');
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');
      doc.text(`Name: ${data.employeeName}`);
      doc.text(`Title: ${data.title}`);
      doc.text(`Department: ${data.department}`);
      doc.moveDown(1);

      // Compensation Breakdown
      doc.fontSize(14).font('Helvetica-Bold').text('Compensation Breakdown');
      doc.moveDown(0.5);

      const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
        }).format(n);

      // Table header
      const tableTop = doc.y;
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Category', 50, tableTop, { width: 300 });
      doc.text('Value', 400, tableTop, { width: 145, align: 'right' });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.3);

      // Table rows
      doc.font('Helvetica').fontSize(10);
      for (const item of data.breakdown) {
        const y = doc.y;
        doc.text(item.category, 50, y, { width: 300 });
        doc.text(fmt(item.value), 400, y, { width: 145, align: 'right' });
        doc.moveDown(0.5);
      }

      // Total row
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(11);
      const totalY = doc.y;
      doc.text('Total Rewards Value', 50, totalY, { width: 300 });
      doc.text(fmt(data.totalRewardsValue), 400, totalY, { width: 145, align: 'right' });
      doc.moveDown(2);

      // Footer
      doc.fontSize(8).font('Helvetica').fillColor('#888888');
      doc.text(
        'This statement is confidential and intended solely for the named employee. Generated by Compport AI Platform.',
        50,
        doc.page.height - 80,
        { align: 'center', width: 495 },
      );
      doc.text(
        `Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        {
          align: 'center',
          width: 495,
        },
      );

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }
}
