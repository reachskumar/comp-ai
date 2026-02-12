import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export enum BenefitPlanTypeDto {
  MEDICAL = 'MEDICAL',
  DENTAL = 'DENTAL',
  VISION = 'VISION',
  LIFE = 'LIFE',
  DISABILITY = 'DISABILITY',
}

export class CreatePlanDto {
  @ApiProperty({ enum: BenefitPlanTypeDto, example: 'MEDICAL' })
  @IsEnum(BenefitPlanTypeDto)
  planType!: BenefitPlanTypeDto;

  @ApiProperty({ example: 'Blue Cross PPO Gold' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Blue Cross Blue Shield' })
  @IsString()
  @IsNotEmpty()
  carrier!: string;

  @ApiPropertyOptional({ example: 'Comprehensive PPO plan with nationwide coverage' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'PPO' })
  @IsOptional()
  @IsString()
  network?: string;

  @ApiPropertyOptional({ description: 'Premium amounts per tier as JSON' })
  @IsOptional()
  premiums?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Deductible amounts as JSON' })
  @IsOptional()
  deductibles?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Out-of-pocket max as JSON' })
  @IsOptional()
  outOfPocketMax?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Copay amounts as JSON' })
  @IsOptional()
  copays?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Coverage details as JSON' })
  @IsOptional()
  coverageDetails?: Record<string, unknown>;

  @ApiProperty({ example: '2026-01-01T00:00:00Z' })
  @IsDateString()
  effectiveDate!: string;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}

export class PlanQueryDto {
  @ApiPropertyOptional({ enum: BenefitPlanTypeDto })
  @IsOptional()
  @IsEnum(BenefitPlanTypeDto)
  planType?: BenefitPlanTypeDto;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

