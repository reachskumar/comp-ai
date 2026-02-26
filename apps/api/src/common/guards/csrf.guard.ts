import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';

/** Paths excluded from CSRF validation (no existing session expected). */
const EXCLUDED_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/health',
  '/api-docs',
];

/** HTTP methods that are safe (read-only) and don't need CSRF protection. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const method = request.method.toUpperCase();

    // Safe methods don't need CSRF protection
    if (SAFE_METHODS.has(method)) {
      return Promise.resolve(true);
    }

    // Check excluded paths
    const url = (request.url ?? '').split('?')[0] ?? ''; // strip query string
    if (EXCLUDED_PATHS.some((p) => url === p || url.startsWith(p + '/'))) {
      return Promise.resolve(true);
    }

    // Validate CSRF token via the Fastify plugin
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    return new Promise<boolean>((resolve) => {
      request.server.csrfProtection(request, reply, (err?: Error) => {
        if (err) {
          this.logger.warn(`CSRF validation failed for ${method} ${url}`);
          throw new ForbiddenException('Invalid or missing CSRF token');
        }
        resolve(true);
      });
    });
  }
}
