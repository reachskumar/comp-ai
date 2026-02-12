import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database';

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { tenantId?: string } }>();
    const tenantId = request.user?.tenantId;

    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required');
    }

    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      this.logger.warn(`Tenant not found: ${tenantId}`);
      throw new ForbiddenException('Tenant not found or inactive');
    }

    return true;
  }
}

