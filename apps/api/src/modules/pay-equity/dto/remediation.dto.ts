import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalculateRemediationDto {
  @ApiProperty({
    description:
      'Target adjusted gap percent. Adjustments are sized to bring the worst-cohort gap down to this value.',
    default: 2,
  })
  @IsNumber()
  @Min(0)
  @Max(50)
  targetGapPercent!: number;

  @ApiPropertyOptional({
    description:
      'Cap a single employee adjustment at this percent of base salary (e.g. 0.15 = 15%).',
    default: 0.15,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  maxPerEmployeePct?: number;

  @ApiPropertyOptional({ description: 'Optional human note recorded with the run.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DecideRemediationDto {
  @ApiProperty({ enum: ['APPROVED', 'DECLINED'] })
  @IsIn(['APPROVED', 'DECLINED'])
  decision!: 'APPROVED' | 'DECLINED';

  @ApiPropertyOptional({ description: 'Optional reviewer note.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
