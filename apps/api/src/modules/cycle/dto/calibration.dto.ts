import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsEnum,
  IsObject,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCalibrationSessionDto {
  @ApiProperty({ example: 'Engineering L5-L7 Calibration', description: 'Session name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Array of recommendation IDs to include in calibration',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recommendationIds?: string[];

  @ApiPropertyOptional({ description: 'Filter participants by department' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Filter participants by level' })
  @IsOptional()
  @IsString()
  level?: string;
}

export class CalibrationOutcomeDto {
  @ApiProperty({ description: 'Recommendation ID' })
  @IsString()
  @IsNotEmpty()
  recommendationId!: string;

  @ApiPropertyOptional({ description: 'Adjusted proposed value after calibration' })
  @IsOptional()
  @Type(() => Number)
  adjustedValue?: number;

  @ApiPropertyOptional({ description: 'New rank/position after calibration' })
  @IsOptional()
  @Type(() => Number)
  rank?: number;

  @ApiPropertyOptional({ description: 'Notes from calibration discussion' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCalibrationSessionDto {
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
    description: 'New session status',
  })
  @IsOptional()
  @IsEnum(['ACTIVE', 'COMPLETED', 'CANCELLED'])
  status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

  @ApiPropertyOptional({
    type: [CalibrationOutcomeDto],
    description: 'Calibration outcomes for recommendations',
  })
  @IsOptional()
  @IsArray()
  outcomes?: CalibrationOutcomeDto[];

  @ApiPropertyOptional({ description: 'Additional session metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CalibrationQueryDto {
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

  @ApiPropertyOptional({
    enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'],
    description: 'Filter by session status',
  })
  @IsOptional()
  @IsString()
  status?: string;
}

