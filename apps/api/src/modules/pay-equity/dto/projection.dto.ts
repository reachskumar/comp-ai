import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class HiringPlanItemDto {
  @ApiProperty()
  @IsString()
  level!: string;

  @ApiProperty()
  @IsString()
  dimension!: string;

  @ApiProperty()
  @IsString()
  group!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  count!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  meanSalary!: number;
}

class PromotionPlanCohortDto {
  @ApiProperty()
  @IsString()
  dimension!: string;

  @ApiProperty()
  @IsString()
  group!: string;
}

class PromotionPlanItemDto {
  @ApiProperty({ type: PromotionPlanCohortDto })
  @ValidateNested()
  @Type(() => PromotionPlanCohortDto)
  cohort!: PromotionPlanCohortDto;

  @ApiProperty()
  @IsInt()
  @Min(1)
  employees!: number;

  @ApiProperty()
  @IsString()
  toLevel!: string;
}

export class ForecastProjectionDto {
  @ApiPropertyOptional({ default: 12, description: 'Forecast horizon in months.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  horizonMonths?: number;

  @ApiPropertyOptional({ description: 'Free-text label shown on the run row.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  scenarioLabel?: string;

  @ApiPropertyOptional({ type: [HiringPlanItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HiringPlanItemDto)
  hiringPlan?: HiringPlanItemDto[];

  @ApiPropertyOptional({ type: [PromotionPlanItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionPlanItemDto)
  promotionPlan?: PromotionPlanItemDto[];
}
