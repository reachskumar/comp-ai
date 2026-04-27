import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Cycle-level eligibility rules. Stored as `CompCycle.settings.eligibility`.
 * Empty array filters mean "no constraint on that dimension".
 */
export class CycleEligibilityDto {
  @ApiPropertyOptional({
    description: 'Minimum tenure in days (employee must have hired ≥ N days ago).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(36500)
  minTenureDays?: number;

  @ApiPropertyOptional({ description: 'Minimum performance rating (Decimal 3.1).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minPerformanceRating?: number;

  @ApiPropertyOptional({
    description: 'Restrict to these departments. Empty = all.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  departments?: string[];

  @ApiPropertyOptional({ description: 'Restrict to these locations. Empty = all.', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  locations?: string[];

  @ApiPropertyOptional({ description: 'Restrict to these levels. Empty = all.', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  levels?: string[];

  @ApiPropertyOptional({
    description: 'Exclude employees with terminationDate set.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  excludeTerminated?: boolean;

  @ApiPropertyOptional({ description: 'Free-text rule note for auditors.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
