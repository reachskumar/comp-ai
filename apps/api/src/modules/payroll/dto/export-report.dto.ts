import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ExportReportDto {
  @ApiPropertyOptional({ enum: ['csv', 'pdf'], default: 'csv', description: 'Export format' })
  @IsOptional()
  @IsString()
  format?: string;
}

