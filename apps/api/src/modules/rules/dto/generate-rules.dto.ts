import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
} from 'class-validator';

export class GenerateRulesDto {
  @ApiProperty({ example: 'FY2027 Merit Policy' })
  @IsString()
  @IsNotEmpty()
  newName!: string;

  @ApiPropertyOptional({ example: 'AI-adjusted merit rules for FY2027' })
  @IsOptional()
  @IsString()
  newDescription?: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({ example: 1.05, description: 'Budget adjustment factor (1.05 = 5% more)' })
  @IsOptional()
  @IsNumber()
  budgetFactor?: number;

  @ApiPropertyOptional({
    example: 1.03,
    description: 'Market adjustment factor (1.03 = 3% market increase)',
  })
  @IsOptional()
  @IsNumber()
  marketFactor?: number;

  @ApiPropertyOptional({ example: true, description: 'Widen performance differentiation spread' })
  @IsOptional()
  @IsBoolean()
  increasePerformanceDiff?: boolean;
}
