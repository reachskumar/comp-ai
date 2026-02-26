import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import type {
  CreateSalaryBandDto,
  UpdateSalaryBandDto,
  SalaryBandQueryDto,
} from './dto/salary-band.dto';
import type {
  CreateMarketDataSourceDto,
  UpdateMarketDataSourceDto,
} from './dto/market-data-source.dto';

@Injectable()
export class BenchmarkingService {
  private readonly logger = new Logger(BenchmarkingService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Salary Bands ─────────────────────────────────────────────

  async listBands(tenantId: string, query: SalaryBandQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.jobFamily) where.jobFamily = query.jobFamily;
    if (query.level) where.level = query.level;
    if (query.location) where.location = query.location;

    const [data, total] = await Promise.all([
      this.db.client.salaryBand.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ jobFamily: 'asc' }, { level: 'asc' }],
      }),
      this.db.client.salaryBand.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async createBand(tenantId: string, dto: CreateSalaryBandDto) {
    return this.db.client.salaryBand.create({
      data: {
        tenantId,
        jobFamily: dto.jobFamily,
        level: dto.level,
        location: dto.location,
        currency: dto.currency || 'USD',
        p10: dto.p10,
        p25: dto.p25,
        p50: dto.p50,
        p75: dto.p75,
        p90: dto.p90,
        source: dto.source,
        effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  async updateBand(tenantId: string, id: string, dto: UpdateSalaryBandDto) {
    const band = await this.db.client.salaryBand.findFirst({
      where: { id, tenantId },
    });
    if (!band) throw new NotFoundException('Salary band not found');

    const data: Record<string, unknown> = {};
    if (dto.jobFamily !== undefined) data.jobFamily = dto.jobFamily;
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.p10 !== undefined) data.p10 = dto.p10;
    if (dto.p25 !== undefined) data.p25 = dto.p25;
    if (dto.p50 !== undefined) data.p50 = dto.p50;
    if (dto.p75 !== undefined) data.p75 = dto.p75;
    if (dto.p90 !== undefined) data.p90 = dto.p90;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.effectiveDate !== undefined) data.effectiveDate = new Date(dto.effectiveDate);
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);

    return this.db.client.salaryBand.update({ where: { id }, data });
  }

  async deleteBand(tenantId: string, id: string) {
    const band = await this.db.client.salaryBand.findFirst({
      where: { id, tenantId },
    });
    if (!band) throw new NotFoundException('Salary band not found');

    await this.db.client.salaryBand.delete({ where: { id } });
    return { deleted: true };
  }

  async bulkImportBands(tenantId: string, bands: CreateSalaryBandDto[]) {
    const results = await this.db.client.$transaction(
      bands.map((dto) =>
        this.db.client.salaryBand.create({
          data: {
            tenantId,
            jobFamily: dto.jobFamily,
            level: dto.level,
            location: dto.location,
            currency: dto.currency || 'USD',
            p10: dto.p10,
            p25: dto.p25,
            p50: dto.p50,
            p75: dto.p75,
            p90: dto.p90,
            source: dto.source,
            effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
          },
        }),
      ),
    );
    this.logger.log(`Bulk imported ${results.length} salary bands for tenant ${tenantId}`);
    return { imported: results.length, bands: results };
  }

  // ─── Compa-Ratio Analysis ─────────────────────────────────────

  async getAnalysis(tenantId: string) {
    // Get all employees with their salary bands
    const employees = await this.db.client.employee.findMany({
      where: { tenantId, terminationDate: null },
      include: { salaryBand: true },
    });

    const bands = await this.db.client.salaryBand.findMany({
      where: { tenantId },
    });

    const analysis = employees.map((emp) => {
      const band = emp.salaryBand;
      const baseSalary = Number(emp.baseSalary);
      const compaRatio = band ? baseSalary / Number(band.p50) : null;
      const p25 = band ? Number(band.p25) : null;
      const p75 = band ? Number(band.p75) : null;

      let positioning: 'below' | 'within' | 'above' | 'unmatched' = 'unmatched';
      if (band) {
        if (baseSalary < Number(band.p25)) positioning = 'below';
        else if (baseSalary > Number(band.p75)) positioning = 'above';
        else positioning = 'within';
      }

      return {
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        firstName: emp.firstName,
        lastName: emp.lastName,
        department: emp.department,
        level: emp.level,
        jobFamily: emp.jobFamily,
        baseSalary,
        currency: emp.currency,
        compaRatio: compaRatio ? Math.round(compaRatio * 10000) / 10000 : null,
        bandId: band?.id || null,
        bandP25: p25,
        bandP50: band ? Number(band.p50) : null,
        bandP75: p75,
        positioning,
      };
    });

    // Summary stats
    const matched = analysis.filter((a) => a.compaRatio !== null);
    const below = matched.filter((a) => a.positioning === 'below');
    const within = matched.filter((a) => a.positioning === 'within');
    const above = matched.filter((a) => a.positioning === 'above');
    const avgCompaRatio = matched.length
      ? matched.reduce((sum, a) => sum + (a.compaRatio || 0), 0) / matched.length
      : null;

    return {
      employees: analysis,
      summary: {
        totalEmployees: employees.length,
        matchedToBands: matched.length,
        unmatched: analysis.filter((a) => a.positioning === 'unmatched').length,
        belowRange: below.length,
        withinRange: within.length,
        aboveRange: above.length,
        avgCompaRatio: avgCompaRatio ? Math.round(avgCompaRatio * 10000) / 10000 : null,
      },
      totalBands: bands.length,
    };
  }

  // ─── Market Data Sources ──────────────────────────────────────

  async listSources(tenantId: string) {
    return this.db.client.marketDataSource.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSource(tenantId: string, dto: CreateMarketDataSourceDto) {
    return this.db.client.marketDataSource.create({
      data: {
        tenantId,
        name: dto.name,
        provider: dto.provider as 'MANUAL' | 'SURVEY' | 'API',
        config: (dto.config || {}) as Record<string, string>,
      },
    });
  }

  async updateSource(tenantId: string, id: string, dto: UpdateMarketDataSourceDto) {
    const source = await this.db.client.marketDataSource.findFirst({
      where: { id, tenantId },
    });
    if (!source) throw new NotFoundException('Market data source not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.config !== undefined) data.config = dto.config;

    return this.db.client.marketDataSource.update({ where: { id }, data });
  }
}
