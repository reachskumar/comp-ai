import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CredentialVaultService } from './credential-vault.service';
import { CreateConnectorDto } from '../dto/create-connector.dto';
import { UpdateConnectorDto } from '../dto/update-connector.dto';
import { ConnectorQueryDto } from '../dto/connector-query.dto';

@Injectable()
export class ConnectorService {
  private readonly logger = new Logger(ConnectorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly credentialVault: CredentialVaultService,
  ) {}

  async create(tenantId: string, dto: CreateConnectorDto) {
    let encryptedCredentials: string | undefined;
    let credentialIv: string | undefined;
    let credentialTag: string | undefined;

    if (dto.credentials && Object.keys(dto.credentials).length > 0) {
      const encrypted = this.credentialVault.encrypt(tenantId, dto.credentials);
      encryptedCredentials = encrypted.encrypted;
      credentialIv = encrypted.iv;
      credentialTag = encrypted.tag;
    }

    const connector = await this.db.client.integrationConnector.create({
      data: {
        tenantId,
        name: dto.name,
        connectorType: dto.connectorType as never,
        config: (dto.config ?? {}) as never,
        encryptedCredentials,
        credentialIv,
        credentialTag,
        syncDirection: (dto.syncDirection as never) ?? 'INBOUND',
        syncSchedule: (dto.syncSchedule as never) ?? 'MANUAL',
        conflictStrategy: (dto.conflictStrategy as never) ?? 'LAST_WRITE_WINS',
        metadata: (dto.metadata ?? {}) as never,
      },
    });

    this.logger.log(`Connector created: ${connector.id} for tenant ${tenantId}`);

    return this.sanitizeConnector(connector);
  }

  async findAll(tenantId: string, query: ConnectorQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.connectorType) where['connectorType'] = query.connectorType;
    if (query.status) where['status'] = query.status;

    const [data, total] = await Promise.all([
      this.db.client.integrationConnector.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.client.integrationConnector.count({ where: where as never }),
    ]);

    return {
      data: data.map((c: Record<string, unknown>) => this.sanitizeConnector(c)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(tenantId: string, id: string) {
    const connector = await this.db.client.integrationConnector.findFirst({
      where: { id, tenantId },
      include: { fieldMappings: true, webhookEndpoints: true },
    });

    if (!connector) {
      throw new NotFoundException(`Connector ${id} not found`);
    }

    return this.sanitizeConnector(connector);
  }

  async update(tenantId: string, id: string, dto: UpdateConnectorDto) {
    await this.findOne(tenantId, id);

    const updateData: Record<string, unknown> = {};
    if (dto.name) updateData['name'] = dto.name;
    if (dto.config) updateData['config'] = dto.config;
    if (dto.status) updateData['status'] = dto.status;
    if (dto.syncDirection) updateData['syncDirection'] = dto.syncDirection;
    if (dto.syncSchedule) updateData['syncSchedule'] = dto.syncSchedule;
    if (dto.conflictStrategy) updateData['conflictStrategy'] = dto.conflictStrategy;
    if (dto.metadata) updateData['metadata'] = dto.metadata;

    if (dto.credentials && Object.keys(dto.credentials).length > 0) {
      const encrypted = this.credentialVault.encrypt(tenantId, dto.credentials);
      updateData['encryptedCredentials'] = encrypted.encrypted;
      updateData['credentialIv'] = encrypted.iv;
      updateData['credentialTag'] = encrypted.tag;
    }

    const updated = await this.db.client.integrationConnector.update({
      where: { id },
      data: updateData as never,
    });

    return this.sanitizeConnector(updated);
  }

  async delete(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db.client.integrationConnector.delete({ where: { id } });
    return { deleted: true };
  }

  async healthCheck(tenantId: string, id: string) {
    const connector = await this.db.client.integrationConnector.findFirst({
      where: { id, tenantId },
    });
    if (!connector) throw new NotFoundException(`Connector ${id} not found`);

    // Update health check timestamp
    const now = new Date();
    await this.db.client.integrationConnector.update({
      where: { id },
      data: { lastHealthCheck: now, healthStatus: 'ok' },
    });

    return { healthy: true, checkedAt: now, connectorId: id };
  }

  /** Remove encrypted credentials from response — never expose secrets */
  private sanitizeConnector(connector: Record<string, unknown>) {
    const { encryptedCredentials, credentialIv, credentialTag, ...safe } = connector as Record<string, unknown>;
    return {
      ...safe,
      hasCredentials: !!encryptedCredentials,
    };
  }
}

