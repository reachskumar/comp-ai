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
import { WebhookDeliveryService } from './services/webhook-delivery.service';
import { SyncProcessor } from './processors/sync.processor';
import { WebhookProcessor, WEBHOOK_DELIVERY_QUEUE } from './processors/webhook.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'integration-sync' }),
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
  ],
  controllers: [ConnectorController, FieldMappingController, WebhookController],
  providers: [
    ConnectorService,
    CredentialVaultService,
    SyncEngineService,
    FieldMappingService,
    WebhookService,
    WebhookDeliveryService,
    SyncProcessor,
    WebhookProcessor,
  ],
  exports: [
    ConnectorService,
    CredentialVaultService,
    FieldMappingService,
    WebhookService,
    WebhookDeliveryService,
    SyncEngineService,
  ],
})
export class IntegrationModule {}
