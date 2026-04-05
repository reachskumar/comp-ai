import { Module, DynamicModule, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CompportBridgeConfig } from './config/compport-bridge.config';
import { CompportDbService } from './services/compport-db.service';
import { CompportApiService } from './services/compport-api.service';
import { CompportSessionService } from './services/compport-session.service';
import { CompportCloudSqlService } from './services/compport-cloudsql.service';
import { WriteBackService } from './services/write-back.service';
import { InboundSyncService } from './services/inbound-sync.service';
import { SchemaDiscoveryService } from './services/schema-discovery.service';
import { TenantRegistryService } from './services/tenant-registry.service';
import { CompportBridgeController } from './compport-bridge.controller';
import { WriteBackController } from './controllers/write-back.controller';
import { InboundSyncController } from './controllers/inbound-sync.controller';
import { IntegrationDashboardController } from './controllers/integration-dashboard.controller';
import { IntegrationDashboardService } from './services/integration-dashboard.service';
import { BridgeRateLimitGuard } from './guards/bridge-rate-limit.guard';
import { WriteBackProcessor, WRITE_BACK_QUEUE } from './processors/write-back.processor';
import { InboundSyncProcessor, INBOUND_SYNC_QUEUE } from './processors/inbound-sync.processor';
import { IntegrationModule } from '../integrations/integrations.module';
import { BullModule } from '@nestjs/bullmq';

/**
 * Compport PHP Bridge Module.
 *
 * Conditionally loaded based on COMPPORT_MODE env var.
 * In standalone mode (default), all services return empty/mock data gracefully.
 *
 * Modes:
 * - standalone: No Compport dependency, services return empty data
 * - shared_db: Reads from Compport PHP tables in shared PostgreSQL
 * - api_bridge: Calls Compport PHP REST API endpoints
 */
@Module({})
export class CompportBridgeModule {
  private static readonly logger = new Logger(CompportBridgeModule.name);

  static register(): DynamicModule {
    this.logger.log('Registering Compport Bridge Module');

    return {
      module: CompportBridgeModule,
      imports: [
        IntegrationModule,
        BullModule.registerQueue({ name: WRITE_BACK_QUEUE }),
        BullModule.registerQueue({ name: INBOUND_SYNC_QUEUE }),
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            secret: configService.get<string>('JWT_SECRET'),
            signOptions: { expiresIn: '15m' },
          }),
        }),
      ],
      controllers: [CompportBridgeController, WriteBackController, InboundSyncController, IntegrationDashboardController],
      providers: [
        CompportBridgeConfig,
        CompportDbService,
        CompportApiService,
        CompportSessionService,
        CompportCloudSqlService,
        WriteBackService,
        WriteBackProcessor,
        InboundSyncService,
        InboundSyncProcessor,
        SchemaDiscoveryService,
        TenantRegistryService,
        IntegrationDashboardService,
        BridgeRateLimitGuard,
      ],
      exports: [
        CompportBridgeConfig,
        CompportDbService,
        CompportApiService,
        CompportSessionService,
        CompportCloudSqlService,
        WriteBackService,
        InboundSyncService,
        SchemaDiscoveryService,
        TenantRegistryService,
        IntegrationDashboardService,
      ],
    };
  }
}
