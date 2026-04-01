import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { DatabaseService } from '../../database';

// ─── Decorator to skip audit logging on specific handlers ────
export const SKIP_AUDIT_KEY = 'skipAudit';
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

// ─── HTTP method → audit action mapping ──────────────────────
const METHOD_ACTION_MAP: Record<string, string> = {
  POST: 'CREATE',
  PATCH: 'UPDATE',
  PUT: 'UPDATE',
  DELETE: 'DELETE',
};

// ─── Sensitive fields to redact from logged changes ──────────
const REDACT_FIELDS = new Set([
  'password',
  'passwordHash',
  'token',
  'apiKey',
  'secret',
  'ssn',
  'accessToken',
  'refreshToken',
]);

function redactBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    redacted[key] = REDACT_FIELDS.has(key) ? '[REDACTED]' : value;
  }
  return redacted;
}

/**
 * Derive entity type from the NestJS controller class name.
 * e.g. AnalyticsController → Analytics, SettingsController → Settings
 */
function deriveEntityType(context: ExecutionContext): string {
  const controllerClass = context.getClass();
  const name = controllerClass.name || 'Unknown';
  return name.replace(/Controller$/, '');
}

/**
 * Extract entity ID from route params — picks :id, :entityId, or first param.
 */
function deriveEntityId(params: Record<string, string>): string {
  if (!params || typeof params !== 'object') return '-';
  return params['id'] || params['entityId'] || Object.values(params)[0] || '-';
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skipAudit = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipAudit) return next.handle();

    const httpCtx = context.switchToHttp();
    const request = httpCtx.getRequest();
    const method: string = (request.method || 'GET').toUpperCase();

    // Only audit write operations
    const action = METHOD_ACTION_MAP[method];
    if (!action) return next.handle();

    const user = request.user as { userId?: string; tenantId?: string; role?: string } | undefined;

    // Must have tenant context to log
    if (!user?.tenantId) return next.handle();

    const entityType = deriveEntityType(context);
    const endpoint = request.url || request.originalUrl || '-';
    const params = request.params || {};
    const entityId = deriveEntityId(params);
    const changes = redactBody(request.body);
    const ipAddress =
      request.ip || request.headers?.['x-forwarded-for'] || request.socket?.remoteAddress || null;

    return next.handle().pipe(
      tap({
        next: () => {
          // Fire-and-forget — don't block response
          this.writeAuditLog(
            user.tenantId!,
            user.userId ?? null,
            action,
            entityType,
            entityId,
            changes,
            ipAddress,
            endpoint,
            method,
          ).catch((err) => this.logger.error('Failed to write audit log', err));
        },
      }),
    );
  }

  private async writeAuditLog(
    tenantId: string,
    userId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    changes: Record<string, unknown>,
    ipAddress: string | null,
    endpoint: string,
    method: string,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      tenantId,
      userId,
      action,
      entityType,
      entityId,
      changes,
      ipAddress,
      endpoint,
      method,
    };
    await this.db.forTenant(tenantId, (tx) => tx.auditLog.create({ data }));
  }
}
