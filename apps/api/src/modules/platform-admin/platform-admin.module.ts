import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { IntegrationModule } from '../integrations/integrations.module';
import { CompportBridgeModule } from '../compport-bridge/compport-bridge.module';

@Module({
  imports: [IntegrationModule, CompportBridgeModule.register()],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
