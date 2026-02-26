import { IsString, IsNotEmpty, IsOptional, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateEquityGrantDto {
  @ApiProperty({ example: 'emp_abc123' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ example: 'plan_xyz789' })
  @IsString()
  @IsNotEmpty()
  planId!: string;

  @ApiProperty({ example: 'RSU', enum: ['RSU', 'ISO', 'NSO', 'SAR', 'PHANTOM'] })
  @IsString()
  @IsNotEmpty()
  grantType!: string;

  @ApiProperty({ example: '2026-03-01T00:00:00Z' })
  @IsDateString()
  grantDate!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  totalShares!: number;

  @ApiProperty({ example: 42.5 })
  @IsNumber()
  grantPrice!: number;

  @ApiPropertyOptional({ example: 55.0 })
  @IsOptional()
  @IsNumber()
  currentPrice?: number;

  @ApiProperty({
    example: 'STANDARD_4Y_1Y_CLIFF',
    enum: ['STANDARD_4Y_1Y_CLIFF', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM'],
  })
  @IsString()
  @IsNotEmpty()
  vestingScheduleType!: string;

  @ApiPropertyOptional({ example: '2026-03-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  vestingStartDate?: string;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  cliffMonths?: number;

  @ApiPropertyOptional({ example: 48 })
  @IsOptional()
  @IsNumber()
  vestingMonths?: number;

  @ApiPropertyOptional({ example: '2036-03-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  expirationDate?: string;
}

export class UpdateEquityGrantDto extends PartialType(CreateEquityGrantDto) {}

export class EquityGrantQueryDto {
  @ApiPropertyOptional({ example: 'emp_abc123' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ example: 'plan_xyz789' })
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiPropertyOptional({ example: 'ACTIVE' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'RSU' })
  @IsOptional()
  @IsString()
  grantType?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  limit?: string;
}
