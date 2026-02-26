import { IsString, IsNotEmpty, IsOptional, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateSalaryBandDto {
  @ApiProperty({ example: 'Engineering' })
  @IsString()
  @IsNotEmpty()
  jobFamily!: string;

  @ApiProperty({ example: 'IC3' })
  @IsString()
  @IsNotEmpty()
  level!: string;

  @ApiPropertyOptional({ example: 'US - San Francisco' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: 80000 })
  @IsNumber()
  p10!: number;

  @ApiProperty({ example: 95000 })
  @IsNumber()
  p25!: number;

  @ApiProperty({ example: 115000 })
  @IsNumber()
  p50!: number;

  @ApiProperty({ example: 135000 })
  @IsNumber()
  p75!: number;

  @ApiProperty({ example: 155000 })
  @IsNumber()
  p90!: number;

  @ApiPropertyOptional({ example: 'Radford 2026' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateSalaryBandDto extends PartialType(CreateSalaryBandDto) {}

export class BulkImportSalaryBandsDto {
  @ApiProperty({ type: [CreateSalaryBandDto] })
  bands!: CreateSalaryBandDto[];
}

export class SalaryBandQueryDto {
  @ApiPropertyOptional({ example: 'Engineering' })
  @IsOptional()
  @IsString()
  jobFamily?: string;

  @ApiPropertyOptional({ example: 'IC3' })
  @IsOptional()
  @IsString()
  level?: string;

  @ApiPropertyOptional({ example: 'US - San Francisco' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  limit?: number;
}
