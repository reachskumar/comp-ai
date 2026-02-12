import { IsString, IsNotEmpty, IsOptional, IsDateString, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateRuleDto {
  @ApiProperty({ example: 'High performer merit increase' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'MERIT', enum: ['MERIT', 'BONUS', 'LTI', 'PRORATION', 'CAP', 'FLOOR', 'ELIGIBILITY', 'CUSTOM'] })
  @IsString()
  @IsNotEmpty()
  ruleType!: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({ example: [{ field: 'performanceRating', operator: 'gte', value: 4 }] })
  @IsOptional()
  @IsArray()
  conditions?: Record<string, unknown>[];

  @ApiPropertyOptional({ example: [{ type: 'setMerit', params: { percentage: 5 } }] })
  @IsOptional()
  @IsArray()
  actions?: Record<string, unknown>[];

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  enabled?: boolean;
}

export class CreateRuleSetDto {
  @ApiProperty({ example: 'FY2026 Merit Policy' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Merit increase rules for fiscal year 2026' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({ type: [CreateRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRuleDto)
  rules?: CreateRuleDto[];
}

export class UpdateRuleSetDto extends PartialType(CreateRuleSetDto) {}

export class UpdateRuleDto extends PartialType(CreateRuleDto) {}

