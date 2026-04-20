import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Abstract base CRUD service that auto-scopes all Prisma queries by tenantId.
 * ALL methods use forTenant() to set RLS context before querying.
 */
export abstract class BaseCrudService<T = unknown> {
  protected abstract readonly modelName: string;

  constructor(protected readonly db: DatabaseService) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getModel(tx: any): any {
    return tx[this.modelName];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected get model(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db.client as any)[this.modelName];
  }

  async findAll(
    tenantId: string,
    pagination: PaginationParams = {},
    where: Record<string, unknown> = {},
  ): Promise<PaginatedResult<T>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const skip = (page - 1) * limit;

    const [data, total] = await this.db.forTenant(tenantId, (tx) => {
      const model = this.getModel(tx);
      return Promise.all([
        model.findMany({
          where: { ...where, tenantId },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        model.count({ where: { ...where, tenantId } }),
      ]);
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(tenantId: string, id: string): Promise<T> {
    const record = (await this.db.forTenant(tenantId, (tx) =>
      this.getModel(tx).findFirst({ where: { id, tenantId } }),
    )) as T | null;

    if (!record) {
      throw new NotFoundException(`${this.modelName} with id ${id} not found`);
    }

    return record;
  }

  async create(tenantId: string, data: Record<string, unknown>): Promise<T> {
    return this.db.forTenant(tenantId, (tx) =>
      this.getModel(tx).create({ data: { ...data, tenantId } }),
    );
  }

  async update(tenantId: string, id: string, data: Record<string, unknown>): Promise<T> {
    await this.findOne(tenantId, id);

    return this.db.forTenant(tenantId, (tx) => this.getModel(tx).update({ where: { id }, data }));
  }

  async delete(tenantId: string, id: string): Promise<T> {
    await this.findOne(tenantId, id);

    return this.db.forTenant(tenantId, (tx) => this.getModel(tx).delete({ where: { id } }));
  }
}
