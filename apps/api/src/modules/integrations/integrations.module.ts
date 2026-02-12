import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConnectorController } from './controllers/connector.controller';
import { FieldMappingController } from './controllers/field-mapping.controller';
import { WebhookController } from './controllers/webhook.controller';
import { ConnectorService } from './services/connector.service';
import { CredentialVaultService } from './services/credential-vault.service';
import { SyncEngineService } from './services/sync-engine.service';
import { FieldMappingService } from './services/field-mapping.service';
import { WebhookService } from './services/webhook.service';
import { SyncProcessor } from './processors/sync.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'integration-sync' }),
  ],
  controllers: [
    ConnectorController,
    FieldMappingController,
    WebhookController,
  ],
  providers: [
    ConnectorService,
    CredentialVaultService,
    SyncEngineService,
    FieldMappingService,
    WebhookService,
    SyncProcessor,
  ],
  exports: [
    ConnectorService,
    FieldMappingService,
    WebhookService,
    SyncEngineService,
  ],
})
export class IntegrationModule {}

