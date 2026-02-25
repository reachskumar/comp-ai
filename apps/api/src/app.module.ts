import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { AuthModule } from './auth';
import { HealthModule } from './health';
import { QueueModule } from './queue';
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
  ],
})
export class AppModule {}
