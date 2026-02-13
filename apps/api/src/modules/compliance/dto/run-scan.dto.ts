import { IsOptional, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RunScanDto {
  @ApiPropertyOptional({
    description: 'Optional scan configuration overrides',
    example: { categories: ['FLSA_OVERTIME', 'PAY_EQUITY'] },
  })
  @IsObject()
  @IsOptional()
  scanConfig?: Record<string, unknown>;
}

