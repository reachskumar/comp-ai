import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateEquityPlanDto {
  @ApiProperty({ example: '2026 RSU Plan' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'RSU', enum: ['RSU', 'ISO', 'NSO', 'SAR', 'PHANTOM'] })
  @IsString()
  @IsNotEmpty()
  planType!: string;

  @ApiProperty({ example: 10000000 })
  @IsNumber()
  totalSharesAuthorized!: number;

  @ApiProperty({ example: 42.5 })
  @IsNumber()
  sharePrice!: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: '2026-01-01T00:00:00Z' })
  @IsDateString()
  effectiveDate!: string;

  @ApiPropertyOptional({ example: '2036-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  expirationDate?: string;

  @ApiPropertyOptional({ example: 'Company-wide RSU plan for all employees' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateEquityPlanDto extends PartialType(CreateEquityPlanDto) {}

export class EquityPlanQueryDto {
  @ApiPropertyOptional({ example: 'RSU' })
  @IsOptional()
  @IsString()
  planType?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  isActive?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  limit?: string;
}
