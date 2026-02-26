import { IsString, IsNotEmpty, IsOptional, IsDateString, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export const AD_HOC_TYPES = [
  'SPOT_BONUS',
  'RETENTION_BONUS',
  'MARKET_ADJUSTMENT',
  'PROMOTION',
  'EQUITY_ADJUSTMENT',
  'OTHER',
] as const;

export class CreateAdHocDto {
  @ApiProperty({ example: 'emp_abc123' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({
    example: 'SPOT_BONUS',
    enum: AD_HOC_TYPES,
  })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ example: 'Outstanding Q1 performance' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiProperty({ example: 85000 })
  @IsNumber()
  currentValue!: number;

  @ApiProperty({ example: 92000 })
  @IsNumber()
  proposedValue!: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: '2026-03-01T00:00:00Z' })
  @IsDateString()
  effectiveDate!: string;

  @ApiPropertyOptional({ description: 'Additional metadata as JSON' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateAdHocDto extends PartialType(CreateAdHocDto) {}
