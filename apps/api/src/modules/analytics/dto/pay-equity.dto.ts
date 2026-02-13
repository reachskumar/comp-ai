import { IsArray, IsOptional, IsNumber, IsString, ArrayMinSize, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class PayEquityAnalyzeDto {
  @ApiProperty({
    description: 'Demographic dimensions to analyze',
    example: ['gender', 'ethnicity'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  dimensions!: string[];

  @ApiPropertyOptional({
    description: 'Control variables for regression',
    example: ['job_level', 'tenure', 'performance', 'location', 'department'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  controlVariables?: string[];

  @ApiPropertyOptional({
    description: 'Maximum acceptable gap percentage (default: 2)',
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  targetThreshold?: number;
}

export class RemediationSimulateDto {
  @ApiProperty({
    description: 'Adjustment percentage to simulate',
    example: 3,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  adjustmentPercent!: number;

  @ApiPropertyOptional({
    description: 'Specific groups to target (if not provided, all significant gaps are targeted)',
    type: 'array',
  })
  @IsOptional()
  @IsArray()
  targetGroups?: Array<{ dimension: string; group: string }>;
}

