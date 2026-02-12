import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Extracts tenantId from JWT claims (set by Passport) and attaches it to the request.
 * This runs after authentication, so req.user should already be populated.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  use(req: FastifyRequest['raw'] & { user?: { tenantId?: string }; tenantId?: string }, _res: FastifyReply['raw'], next: () => void): void {
    if (req.user?.tenantId) {
      req.tenantId = req.user.tenantId;
    }
    next();
  }
}

