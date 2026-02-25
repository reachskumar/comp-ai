import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

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

  // Global logging interceptor
  app.useGlobalInterceptors(new LoggingInterceptor());

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
}

bootstrap();
