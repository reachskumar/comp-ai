import {
  Injectable,
  Logger,
  OnModuleDestroy,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ShutdownService handles graceful application shutdown.
 *
 * Lifecycle order (NestJS):
 *   1. BeforeApplicationShutdown — drain in-flight requests
 *   2. OnModuleDestroy — cleanup resources (DB, Redis, etc.)
 *
 * This service logs each phase and waits for in-flight work to complete
 * before allowing the application to tear down module resources.
 */
@Injectable()
export class ShutdownService
  implements BeforeApplicationShutdown, OnModuleDestroy
{
  private readonly logger = new Logger(ShutdownService.name);
  private readonly shutdownTimeout: number;

  constructor(private readonly configService: ConfigService) {
    this.shutdownTimeout =
      this.configService.get<number>('SHUTDOWN_TIMEOUT') ?? 30_000;
  }

  /**
   * Called BEFORE modules are destroyed.
   * Use this phase to stop accepting new requests and drain in-flight ones.
   */
  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `Shutdown initiated (signal: ${signal ?? 'unknown'}) — draining connections...`,
    );

    // Give in-flight HTTP requests time to complete.
    // Fastify's close() (called by NestJS) stops accepting new connections
    // and waits for existing ones to finish, but we add a small buffer
    // to let any trailing work wrap up.
    const drainMs = Math.min(this.shutdownTimeout, 5_000);
    await this.sleep(drainMs);

    this.logger.log('Connections drained');
  }

  /**
   * Called AFTER beforeApplicationShutdown, when modules are being destroyed.
   * Database and queue cleanup happens in their own OnModuleDestroy hooks.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('All modules destroyed — shutdown complete. Goodbye');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

