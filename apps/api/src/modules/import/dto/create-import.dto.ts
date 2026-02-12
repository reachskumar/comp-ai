import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsObject } from 'class-validator';

export class CreateImportDto {
  @ApiPropertyOptional({ description: 'Optional import settings (JSON)' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

