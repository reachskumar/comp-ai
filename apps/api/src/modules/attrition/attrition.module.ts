import { Module } from '@nestjs/common';
import { AttritionController } from './attrition.controller';
import { AttritionService } from './attrition.service';

@Module({
  controllers: [AttritionController],
  providers: [AttritionService],
  exports: [AttritionService],
})
export class AttritionModule {}
