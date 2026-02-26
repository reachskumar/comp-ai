import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CsrfGuard } from './common/guards/csrf.guard';
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
import { BenchmarkingModule } from './modules/benchmarking';
import { MeritMatrixModule } from './modules/merit-matrix';
import { AdHocModule } from './modules/adhoc';
import { CurrencyModule } from './modules/currency';
import { RewardsStatementModule } from './modules/rewards-statement';
import { EquityModule } from './modules/equity';
import { PolicyRagModule } from './modules/policy-rag';
import { AttritionModule } from './modules/attrition';
import { NotificationModule } from './modules/notifications';
import { EmployeePortalModule } from './modules/employee-portal';
import { JobArchitectureModule } from './modules/job-architecture';
import { CsrfModule } from './csrf';

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
    BenchmarkingModule,
    MeritMatrixModule,
    AdHocModule,
    CurrencyModule,
    RewardsStatementModule,
    EquityModule,
    PolicyRagModule,
    AttritionModule,
    NotificationModule,
    EmployeePortalModule,
    JobArchitectureModule,
    CsrfModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    ShutdownService,
  ],
})
export class AppModule {}
