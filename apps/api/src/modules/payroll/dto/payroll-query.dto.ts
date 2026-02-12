import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class PayrollQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PROCESSING', 'REVIEW', 'APPROVED', 'FINALIZED', 'ERROR'] })
  @IsOptional()
  @IsString()
  status?: string;
}

export class AnomalyQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: ['NEGATIVE_NET', 'SPIKE', 'DROP', 'UNUSUAL_DEDUCTION', 'MISSING_COMPONENT', 'DUPLICATE', 'CUSTOM'] })
  @IsOptional()
  @IsString()
  anomalyType?: string;

  @ApiPropertyOptional({ enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] })
  @IsOptional()
  @IsString()
  severity?: string;

  @ApiPropertyOptional({ description: 'Filter by resolved status' })
  @IsOptional()
  @IsString()
  resolved?: string;
}

