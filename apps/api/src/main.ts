import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

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

  // Enable CORS with origin whitelist
  const corsOrigins: string[] = ['http://localhost:3000'];
  if (process.env['CORS_ORIGINS']) {
    corsOrigins.push(
      ...process.env['CORS_ORIGINS'].split(',').map((o) => o.trim()).filter(Boolean),
    );
  }
  await app.register(import('@fastify/cors') as never, {
    origin: corsOrigins,
    credentials: true,
  });

  // Enable multipart file uploads
  await app.register(import('@fastify/multipart') as never, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });

  // Global prefix for API routes (exclude health and api-docs)
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'api-docs', 'api-docs-json'],
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
    app.close().then(() => {
      logger.log('Application closed successfully');
      process.exit(0);
    }).catch((err) => {
      logger.error('Error during shutdown', err);
      process.exit(1);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

bootstrap();
