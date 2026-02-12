import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEnum,
  IsArray,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum BenefitTierDto {
  EMPLOYEE = 'EMPLOYEE',
  EMPLOYEE_SPOUSE = 'EMPLOYEE_SPOUSE',
  EMPLOYEE_CHILDREN = 'EMPLOYEE_CHILDREN',
  FAMILY = 'FAMILY',
}

export enum EnrollmentStatusDto {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  TERMINATED = 'TERMINATED',
  WAIVED = 'WAIVED',
}

export class CreateEnrollmentDto {
  @ApiProperty({ example: 'clxyz123' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ example: 'clxyz456' })
  @IsString()
  @IsNotEmpty()
  planId!: string;

  @ApiProperty({ enum: BenefitTierDto, example: 'EMPLOYEE' })
  @IsEnum(BenefitTierDto)
  tier!: BenefitTierDto;

  @ApiProperty({ example: '2026-01-01T00:00:00Z' })
  @IsDateString()
  effectiveDate!: string;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Dependent IDs to include in enrollment' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependentIds?: string[];
}

export class UpdateEnrollmentStatusDto {
  @ApiProperty({ enum: EnrollmentStatusDto })
  @IsEnum(EnrollmentStatusDto)
  status!: EnrollmentStatusDto;
}

export class EnrollmentQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ enum: EnrollmentStatusDto })
  @IsOptional()
  @IsEnum(EnrollmentStatusDto)
  status?: EnrollmentStatusDto;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;
}

