import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Metadata key for the @Roles() decorator.
 */
export const ROLES_KEY = 'roles';

/**
 * Decorator to restrict an endpoint to specific user roles.
 *
 * @example
 * ```ts
 * @Roles('ADMIN', 'HR_MANAGER')
 * @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
 * @Post('create')
 * async create() { ... }
 * ```
 *
 * Roles follow the Compport IQ hierarchy:
 *   PLATFORM_ADMIN > ADMIN > HR_MANAGER > MANAGER > ANALYST > EMPLOYEE
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Guard that checks `req.user.role` against the roles specified by @Roles().
 * If no @Roles() decorator is present, the endpoint is accessible to all authenticated users.
 *
 * Must be placed AFTER JwtAuthGuard (so req.user is populated).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get roles from the handler first, then fall back to the class
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() → allow all authenticated users
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { userId?: string; role?: string };
    }>();

    const userRole = request.user?.role;

    if (!userRole) {
      this.logger.warn(`Role check failed: no role on user ${request.user?.userId}`);
      throw new ForbiddenException('User role is required');
    }

    // PLATFORM_ADMIN bypasses all role checks
    if (userRole === 'PLATFORM_ADMIN') {
      return true;
    }

    if (!requiredRoles.includes(userRole)) {
      this.logger.warn(
        `Access denied: user=${request.user?.userId} role=${userRole} required=${requiredRoles.join(',')}`,
      );
      throw new ForbiddenException(
        `Access denied. Required role: ${requiredRoles.join(' or ')}. Your role: ${userRole}.`,
      );
    }

    return true;
  }
}
