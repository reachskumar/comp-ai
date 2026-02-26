import { Module } from '@nestjs/common';
import { AdHocController } from './adhoc.controller';
import { AdHocService } from './adhoc.service';

@Module({
  controllers: [AdHocController],
  providers: [AdHocService],
  exports: [AdHocService],
})
export class AdHocModule {}
