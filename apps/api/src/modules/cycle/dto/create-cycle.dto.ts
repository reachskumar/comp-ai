import { IsString, IsNotEmpty, IsOptional, IsDateString, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateCycleDto {
  @ApiProperty({ example: 'FY2026 Annual Merit Cycle' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'MERIT', enum: ['MERIT', 'BONUS', 'LTI', 'COMBINED'] })
  @IsString()
  @IsNotEmpty()
  cycleType!: string;

  @ApiPropertyOptional({ example: 1000000 })
  @IsOptional()
  @IsNumber()
  budgetTotal?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: '2026-01-01T00:00:00Z' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-12-31T00:00:00Z' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Additional cycle settings as JSON' })
  @IsOptional()
  settings?: Record<string, unknown>;
}

export class UpdateCycleDto extends PartialType(CreateCycleDto) {}

