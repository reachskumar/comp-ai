import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import type { CreateMeritMatrixDto, UpdateMeritMatrixDto } from './dto';

interface MatrixCell {
  perfRating: number;
  compaRatioRange: string;
  increasePercent: number;
}

@Injectable()
export class MeritMatrixService {
  private readonly logger = new Logger(MeritMatrixService.name);

  constructor(private readonly db: DatabaseService) {}

  async list(tenantId: string) {
    return this.db.client.meritMatrix.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { cycles: true } } },
    });
  }

  async getById(tenantId: string, id: string) {
    const matrix = await this.db.client.meritMatrix.findFirst({
      where: { id, tenantId },
      include: { cycles: { select: { id: true, name: true, status: true } } },
    });
    if (!matrix) throw new NotFoundException(`Merit matrix ${id} not found`);
    return matrix;
  }

  async create(tenantId: string, dto: CreateMeritMatrixDto) {
    if (dto.isDefault) {
      await this.db.client.meritMatrix.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return this.db.client.meritMatrix.create({
      data: {
        tenantId,
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        matrix: dto.matrix as never,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateMeritMatrixDto) {
    await this.getById(tenantId, id);
    if (dto.isDefault) {
      await this.db.client.meritMatrix.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name;
    if (dto.isDefault !== undefined) data['isDefault'] = dto.isDefault;
    if (dto.matrix !== undefined) data['matrix'] = dto.matrix;
    return this.db.client.meritMatrix.update({ where: { id }, data });
  }

  async delete(tenantId: string, id: string) {
    await this.getById(tenantId, id);
    return this.db.client.meritMatrix.delete({ where: { id } });
  }

  async simulate(tenantId: string, id: string) {
    const matrix = await this.getById(tenantId, id);
    const cells = matrix.matrix as unknown as MatrixCell[];
    const employees = await this.db.client.employee.findMany({
      where: { tenantId, performanceRating: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        department: true,
        level: true,
        baseSalary: true,
        totalComp: true,
        performanceRating: true,
      },
    });

    const deptStats = new Map<string, { min: number; max: number }>();
    for (const emp of employees) {
      const salary = Number(emp.baseSalary);
      const existing = deptStats.get(emp.department);
      if (!existing) {
        deptStats.set(emp.department, { min: salary, max: salary });
      } else {
        existing.min = Math.min(existing.min, salary);
        existing.max = Math.max(existing.max, salary);
      }
    }

    let totalCurrentCost = 0;
    let totalProjectedCost = 0;
    const cellDistribution: Record<string, { count: number; employees: string[] }> = {};

    const results = employees.map((emp) => {
      const salary = Number(emp.baseSalary);
      const perfRating = Number(emp.performanceRating);
      const stats = deptStats.get(emp.department);
      const midpoint = stats ? (stats.min + stats.max) / 2 : salary;
      const compaRatio = midpoint > 0 ? salary / midpoint : 1.0;
      const matchingCell = cells.find((c) => {
        if (c.perfRating !== Math.round(perfRating)) return false;
        return this.isInRange(compaRatio, c.compaRatioRange);
      });
      const increasePercent = matchingCell?.increasePercent ?? 0;
      const projectedSalary = Math.round(salary * (1 + increasePercent / 100));
      totalCurrentCost += salary;
      totalProjectedCost += projectedSalary;
      const cellKey = `${Math.round(perfRating)}_${matchingCell?.compaRatioRange ?? 'none'}`;
      if (!cellDistribution[cellKey]) cellDistribution[cellKey] = { count: 0, employees: [] };
      cellDistribution[cellKey]!.count++;
      cellDistribution[cellKey]!.employees.push(`${emp.firstName} ${emp.lastName}`);
      return {
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        department: emp.department,
        level: emp.level,
        currentSalary: salary,
        performanceRating: perfRating,
        compaRatio: Math.round(compaRatio * 100) / 100,
        increasePercent,
        projectedSalary,
        costDelta: projectedSalary - salary,
      };
    });

    return {
      matrixId: id,
      totalEmployees: employees.length,
      totalCurrentCost,
      totalProjectedCost,
      totalCostDelta: totalProjectedCost - totalCurrentCost,
      cellDistribution,
      employees: results,
    };
  }

  async applyToCycle(tenantId: string, matrixId: string, cycleId: string) {
    await this.getById(tenantId, matrixId);
    const cycle = await this.db.client.compCycle.findFirst({
      where: { id: cycleId, tenantId },
    });
    if (!cycle) throw new NotFoundException(`Cycle ${cycleId} not found`);

    await this.db.client.compCycle.update({
      where: { id: cycleId },
      data: { meritMatrixId: matrixId },
    });

    const simulation = await this.simulate(tenantId, matrixId);
    let created = 0;
    let updated = 0;

    for (const emp of simulation.employees) {
      if (emp.increasePercent <= 0) continue;
      const existing = await this.db.client.compRecommendation.findFirst({
        where: { cycleId, employeeId: emp.employeeId, recType: 'MERIT_INCREASE' },
      });
      if (existing) {
        await this.db.client.compRecommendation.update({
          where: { id: existing.id },
          data: {
            currentValue: emp.currentSalary,
            proposedValue: emp.projectedSalary,
            justification: `Merit matrix: ${emp.increasePercent}% increase (perf=${emp.performanceRating}, CR=${emp.compaRatio})`,
          },
        });
        updated++;
      } else {
        await this.db.client.compRecommendation.create({
          data: {
            cycleId,
            employeeId: emp.employeeId,
            recType: 'MERIT_INCREASE',
            currentValue: emp.currentSalary,
            proposedValue: emp.projectedSalary,
            justification: `Merit matrix: ${emp.increasePercent}% increase (perf=${emp.performanceRating}, CR=${emp.compaRatio})`,
            status: 'DRAFT',
          },
        });
        created++;
      }
    }

    this.logger.log(
      `Applied matrix ${matrixId} to cycle ${cycleId}: ${created} created, ${updated} updated`,
    );
    return { matrixId, cycleId, created, updated, total: created + updated };
  }

  private isInRange(value: number, range: string): boolean {
    if (range.startsWith('<')) return value < parseFloat(range.slice(1));
    if (range.startsWith('>')) return value > parseFloat(range.slice(1));
    const parts = range.split('-');
    if (parts.length === 2) {
      const low = parseFloat(parts[0]!);
      const high = parseFloat(parts[1]!);
      return value >= low && value < high;
    }
    return false;
  }
}
