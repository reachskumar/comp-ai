import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { IncomingMessage } from 'http';
import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { AuthModule } from './auth';
import { HealthModule } from './health';
import { QueueModule } from './queue';
import { ShutdownService } from './common/lifecycle';
import { ImportModule } from './modules/import';
import { RulesModule } from './modules/rules';
import { PayrollModule } from './modules/payroll';
import { CycleModule } from './modules/cycle';
import { CompportBridgeModule } from './modules/compport-bridge';
import { IntegrationModule } from './modules/integrations';
import { AnalyticsModule } from './modules/analytics';
import { BenefitsModule } from './modules/benefits';
import { CopilotModule } from './modules/copilot';
import { LettersModule } from './modules/letters';
import { ComplianceModule } from './modules/compliance';
import { ReportsModule } from './modules/reports';
import { DashboardModule } from './modules/dashboard';
import { SettingsModule } from './modules/settings';

const isProduction = process.env['NODE_ENV'] === 'production';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 60,
      },
    ]),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] || (isProduction ? 'info' : 'debug'),
        // Use X-Request-Id header or generate a UUID for correlation
        genReqId: (req: IncomingMessage) => {
          const existing = req.headers['x-request-id'];
          return (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
        },
        // PII masking — never log sensitive fields
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'password',
            'passwordHash',
            'ssn',
            'token',
            'apiKey',
            'secret',
            '*.password',
            '*.passwordHash',
            '*.ssn',
            '*.token',
            '*.apiKey',
            '*.secret',
          ],
          censor: '[REDACTED]',
        },
        // Pretty-print in development, JSON in production
        transport: isProduction
          ? undefined
          : {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: false,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            },
      },
    }),
    AuthModule,
    HealthModule,
    QueueModule,
    ImportModule,
    RulesModule,
    PayrollModule,
    CycleModule,
    CompportBridgeModule.register(),
    IntegrationModule,
    AnalyticsModule,
    BenefitsModule,
    CopilotModule,
    LettersModule,
    ComplianceModule,
    ReportsModule,
    DashboardModule,
    SettingsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    ShutdownService,
  ],
})
export class AppModule {}
