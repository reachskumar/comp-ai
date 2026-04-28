import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const ALLOWED_DIMENSIONS = ['gender', 'ethnicity', 'age_band', 'department', 'location'] as const;

export class RunPayEquityAnalysisDto {
  @ApiProperty({
    description: 'Protected-class dimensions to analyze.',
    example: ['gender'],
    isArray: true,
    enum: ALLOWED_DIMENSIONS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  dimensions!: string[];

  @ApiPropertyOptional({
    description: 'Predictors to control for in regression.',
    example: ['job_level', 'tenure', 'performance', 'location', 'department'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  controlVariables?: string[];

  @ApiPropertyOptional({
    description: 'Maximum acceptable gap % before flagging for remediation. Defaults to 2.',
    default: 2,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  targetThreshold?: number;

  @ApiPropertyOptional({ description: 'Optional human note recorded with the run.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
