import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';

/**
 * Guard that restricts access to PLATFORM_ADMIN users only.
 * Used for cross-tenant management endpoints.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly logger = new Logger(PlatformAdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { userId?: string; role?: string };
    }>();

    const role = request.user?.role;

    if (role !== 'PLATFORM_ADMIN') {
      this.logger.warn(`Platform admin access denied: user=${request.user?.userId}, role=${role}`);
      throw new ForbiddenException('Platform admin access required');
    }

    return true;
  }
}
