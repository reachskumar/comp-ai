import { IsString, IsOptional, IsArray, IsEnum, IsDate, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RunEdgeAnalysisDto {
  @ApiProperty({
    description: 'Analysis type per EDGE methodology',
    enum: ['STANDARD', 'CUSTOMIZED'],
    example: 'STANDARD',
  })
  @IsEnum(['STANDARD', 'CUSTOMIZED'])
  analysisType!: 'STANDARD' | 'CUSTOMIZED';

  @ApiProperty({
    description: 'Name for this analysis run',
    example: 'Q1 2026 Pay Equity Audit',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    description:
      'Additional predictors for CUSTOMIZED analysis (beyond EDGE mandatory set). Max 20.',
    example: ['ftePercent'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customVariables?: string[];

  @ApiPropertyOptional({
    description: 'Reference period start date',
    example: '2025-01-01',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  referencePeriodStart?: Date;

  @ApiPropertyOptional({
    description: 'Reference period end date',
    example: '2025-12-31',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  referencePeriodEnd?: Date;
}
