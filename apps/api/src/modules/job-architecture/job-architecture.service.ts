import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import type {
  CreateJobFamilyDto,
  UpdateJobFamilyDto,
  JobFamilyQueryDto,
} from './dto/job-family.dto';
import type {
  CreateJobLevelDto,
  UpdateJobLevelDto,
  JobLevelQueryDto,
  AssignEmployeesDto,
} from './dto/job-level.dto';
import type {
  CreateCareerLadderDto,
  UpdateCareerLadderDto,
  CareerLadderQueryDto,
} from './dto/career-ladder.dto';

@Injectable()
export class JobArchitectureService {
  private readonly logger = new Logger(JobArchitectureService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Job Families ───────────────────────────────────────────

  async listFamilies(tenantId: string, query: JobFamilyQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';

    const [data, total] = await this.db.forTenant(tenantId, (tx) =>
      Promise.all([
        tx.jobFamily.findMany({
          where,
          skip,
          take: limit,
          orderBy: { name: 'asc' },
          include: { _count: { select: { jobLevels: true } } },
        }),
        tx.jobFamily.count({ where }),
      ]),
    );

    return { data, total, page, limit };
  }

  async getFamily(tenantId: string, id: string) {
    const family = await this.db.forTenant(tenantId, (tx) =>
      tx.jobFamily.findFirst({
        where: { id, tenantId },
        include: {
          jobLevels: {
            orderBy: { grade: 'asc' },
            include: { _count: { select: { employees: true } } },
          },
        },
      }),
    );
    if (!family) throw new NotFoundException('Job family not found');
    return family;
  }

  async createFamily(tenantId: string, dto: CreateJobFamilyDto) {
    return this.db.forTenant(tenantId, (tx) =>
      tx.jobFamily.create({
        data: { tenantId, ...dto },
      }),
    );
  }

  async updateFamily(tenantId: string, id: string, dto: UpdateJobFamilyDto) {
    return this.db.forTenant(tenantId, async (tx) => {
      const existing = await tx.jobFamily.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Job family not found');
      return tx.jobFamily.update({ where: { id }, data: dto });
    });
  }

  async deleteFamily(tenantId: string, id: string) {
    return this.db.forTenant(tenantId, async (tx) => {
      const existing = await tx.jobFamily.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Job family not found');
      await tx.jobFamily.delete({ where: { id } });
      return { deleted: true };
    });
  }

  // ─── Job Levels ─────────────────────────────────────────────

  async listLevels(tenantId: string, query: JobLevelQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 50, 200);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.jobFamilyId) where.jobFamilyId = query.jobFamilyId;
    if (query.grade) where.grade = Number(query.grade);
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';

    const [data, total] = await this.db.forTenant(tenantId, async (tx) => {
      const d = await tx.jobLevel.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ jobFamilyId: 'asc' }, { grade: 'asc' }],
        include: {
          jobFamily: { select: { id: true, name: true, code: true } },
          _count: { select: { employees: true } },
        },
      });
      const t = await tx.jobLevel.count({ where });
      return [d, t] as const;
    });

    return { data, total, page, limit };
  }

  async getLevel(tenantId: string, id: string) {
    const level = await this.db.forTenant(tenantId, (tx) =>
      tx.jobLevel.findFirst({
        where: { id, tenantId },
        include: {
          jobFamily: true,
          nextLevel: { select: { id: true, name: true, code: true, grade: true } },
          previousLevel: { select: { id: true, name: true, code: true, grade: true } },
          employees: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              department: true,
              email: true,
              baseSalary: true,
            },
            take: 100,
          },
        },
      }),
    );
    if (!level) throw new NotFoundException('Job level not found');
    return level;
  }

  async createLevel(tenantId: string, jobFamilyId: string, dto: CreateJobLevelDto) {
    return this.db.forTenant(tenantId, async (tx) => {
      const family = await tx.jobFamily.findFirst({
        where: { id: jobFamilyId, tenantId },
      });
      if (!family) throw new NotFoundException('Job family not found');

      return tx.jobLevel.create({
        data: {
          tenantId,
          jobFamilyId,
          name: dto.name,
          code: dto.code,
          grade: dto.grade,
          description: dto.description,
          minSalary: dto.minSalary,
          midSalary: dto.midSalary,
          maxSalary: dto.maxSalary,
          currency: dto.currency,
          competencies: dto.competencies ?? [],
          nextLevelId: dto.nextLevelId,
          isActive: dto.isActive,
        },
      });
    });
  }

  async updateLevel(tenantId: string, id: string, dto: UpdateJobLevelDto) {
    return this.db.forTenant(tenantId, async (tx) => {
      const existing = await tx.jobLevel.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Job level not found');
      return tx.jobLevel.update({ where: { id }, data: dto as Record<string, unknown> });
    });
  }

  async deleteLevel(tenantId: string, id: string) {
    return this.db.forTenant(tenantId, async (tx) => {
      const existing = await tx.jobLevel.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Job level not found');
      await tx.employee.updateMany({
        where: { jobLevelId: id },
        data: { jobLevelId: null },
      });
      await tx.jobLevel.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async assignEmployees(tenantId: string, levelId: string, dto: AssignEmployeesDto) {
    return this.db.forTenant(tenantId, async (tx) => {
      const level = await tx.jobLevel.findFirst({ where: { id: levelId, tenantId } });
      if (!level) throw new NotFoundException('Job level not found');

      const result = await tx.employee.updateMany({
        where: { id: { in: dto.employeeIds }, tenantId },
        data: { jobLevelId: levelId },
      });

      return { assigned: result.count, levelId };
    });
  }

  async autoAssignEmployees(tenantId: string) {
    return this.db.forTenant(tenantId, async (tx) => {
      const levels = await tx.jobLevel.findMany({
        where: { tenantId, isActive: true },
        include: { jobFamily: { select: { name: true } } },
      });

      let assigned = 0;
      for (const level of levels) {
        const result = await tx.employee.updateMany({
          where: {
            tenantId,
            jobFamily: level.jobFamily.name,
            level: level.name,
            jobLevelId: null,
          },
          data: { jobLevelId: level.id },
        });
        assigned += result.count;
      }

      return { assigned, totalLevels: levels.length };
    });
  }

  // ─── Career Ladders ─────────────────────────────────────────

  async listLadders(tenantId: string, query: CareerLadderQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';

    const [data, total] = await this.db.forTenant(tenantId, async (tx) => {
      const d = await tx.careerLadder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      });
      const t = await tx.careerLadder.count({ where });
      return [d, t] as const;
    });

    return { data, total, page, limit };
  }

  async getLadder(tenantId: string, id: string) {
    const ladder = await this.db.forTenant(tenantId, (tx) =>
      tx.careerLadder.findFirst({ where: { id, tenantId } }),
    );
    if (!ladder) throw new NotFoundException('Career ladder not found');
    return ladder;
  }

  async createLadder(tenantId: string, dto: CreateCareerLadderDto) {
    return this.db.forTenant(tenantId, (tx) =>
      tx.careerLadder.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description,
          tracks: dto.tracks,
          isActive: dto.isActive,
        },
      }),
    );
  }

  async updateLadder(tenantId: string, id: string, dto: UpdateCareerLadderDto) {
    return this.db.forTenant(tenantId, async (tx) => {
      const existing = await tx.careerLadder.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Career ladder not found');
      return tx.careerLadder.update({
        where: { id },
        data: dto as Record<string, unknown>,
      });
    });
  }

  async deleteLadder(tenantId: string, id: string) {
    return this.db.forTenant(tenantId, async (tx) => {
      const existing = await tx.careerLadder.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Career ladder not found');
      await tx.careerLadder.delete({ where: { id } });
      return { deleted: true };
    });
  }

  // ─── Summary ────────────────────────────────────────────────

  async getSummary(tenantId: string) {
    const [familyCount, levelCount, assignedCount, unassignedCount] = await this.db.forTenant(
      tenantId,
      async (tx) => {
        const f = await tx.jobFamily.count({ where: { tenantId, isActive: true } });
        const l = await tx.jobLevel.count({ where: { tenantId, isActive: true } });
        const a = await tx.employee.count({ where: { tenantId, jobLevelId: { not: null } } });
        const u = await tx.employee.count({ where: { tenantId, jobLevelId: null } });
        return [f, l, a, u] as const;
      },
    );

    return {
      families: familyCount,
      levels: levelCount,
      assignedEmployees: assignedCount,
      unassignedEmployees: unassignedCount,
      totalEmployees: assignedCount + unassignedCount,
    };
  }
}
