import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  // Use Pino logger for all NestJS logging
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Enable NestJS shutdown lifecycle hooks (OnModuleDestroy, BeforeApplicationShutdown)
  app.enableShutdownHooks();

  // Response compression (before other plugins for maximum coverage)
  await app.register(import('@fastify/compress') as never, {
    global: true,
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024, // compress responses > 1KB
  });

  // Security headers
  await app.register(import('@fastify/helmet') as never, {
    global: true,
  });

  // Enable CORS with dynamic origin (supports *.compportiq.ai subdomains)
  const extraOrigins = (process.env['CORS_EXTRA_ORIGINS'] || process.env['CORS_ORIGINS'] || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  await app.register(import('@fastify/cors') as never, {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);

      // Allow localhost for development only
      if (process.env['NODE_ENV'] !== 'production') {
        if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
          return callback(null, true);
        }
      }

      // Allow any *.compportiq.ai subdomain
      if (/^https?:\/\/([a-z0-9-]+\.)?compportiq\.ai$/.test(origin)) {
        return callback(null, true);
      }

      // Allow explicitly configured extra origins
      if (extraOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });

  // Cookie support (required for CSRF double-submit pattern)
  await app.register(import('@fastify/cookie') as never, {
    secret: undefined, // unsigned cookies
  });

  // CSRF protection (double-submit cookie pattern)
  await app.register(import('@fastify/csrf-protection') as never, {
    cookieOpts: { signed: false, httpOnly: true, sameSite: 'strict', path: '/' },
  });

  // Enable multipart file uploads
  await app.register(import('@fastify/multipart') as never, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  // Global prefix for API routes (exclude health and api-docs)
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'metrics', 'api-docs', 'api-docs-json'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // HTTP metrics collection via Fastify hooks
  {
    const { MetricsService } = await import('./common/services/metrics.service');
    try {
      const metrics = app.get(MetricsService);
      const fastify = app.getHttpAdapter().getInstance();
      fastify.addHook('onRequest', (_req: unknown, _reply: unknown, done: () => void) => {
        ((_req as Record<string, unknown>).__startTime) = Date.now();
        done();
      });
      fastify.addHook('onResponse', (req: Record<string, unknown>, reply: Record<string, unknown>, done: () => void) => {
        const start = req.__startTime as number | undefined;
        if (start) {
          metrics.recordHttpRequest(
            req.method as string,
            req.url as string,
            reply.statusCode as number,
            Date.now() - start,
          );
        }
        done();
      });
    } catch {
      logger.warn('MetricsService not available — metrics collection disabled');
    }
  }

  // Swagger setup — disabled in production
  if (process.env['NODE_ENV'] !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Compensation Platform API')
      .setDescription('API for the compensation management SaaS platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api-docs', app, document, {
      jsonDocumentUrl: 'api-docs-json',
    });
    logger.log('Swagger docs enabled (non-production)');
  }

  const port = process.env['API_PORT'] || 4000;
  await app.listen(port as number, '0.0.0.0');
  logger.log(`API running on http://localhost:${port}`);

  // Graceful shutdown on SIGTERM / SIGINT
  const shutdownTimeout = parseInt(process.env['SHUTDOWN_TIMEOUT'] ?? '30000', 10);

  const handleShutdown = (signal: string) => {
    logger.log(`Received ${signal} — starting graceful shutdown (timeout: ${shutdownTimeout}ms)`);

    // Force-kill safety net: if graceful shutdown hangs, exit hard
    const forceKillTimer = setTimeout(() => {
      logger.error(`Graceful shutdown timed out after ${shutdownTimeout}ms — forcing exit`);
      process.exit(1);
    }, shutdownTimeout);

    // Allow the process to exit even if the timer is still pending
    forceKillTimer.unref();

    // NestJS app.close() triggers BeforeApplicationShutdown → OnModuleDestroy
    app
      .close()
      .then(() => {
        logger.log('Application closed successfully');
        process.exit(0);
      })
      .catch((err) => {
        logger.error('Error during shutdown', err);
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

bootstrap();
