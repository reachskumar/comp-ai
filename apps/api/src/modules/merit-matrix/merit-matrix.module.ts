import { Module } from '@nestjs/common';
import { MeritMatrixController } from './merit-matrix.controller';
import { MeritMatrixService } from './merit-matrix.service';

@Module({
  controllers: [MeritMatrixController],
  providers: [MeritMatrixService],
  exports: [MeritMatrixService],
})
export class MeritMatrixModule {}
