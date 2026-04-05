import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformConfigController } from './controllers/platform-config.controller';
import { PlatformConfigService } from './services/platform-config.service';

@Module({
  controllers: [PlatformAdminController, PlatformConfigController],
  providers: [PlatformAdminService, PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformAdminModule {}
