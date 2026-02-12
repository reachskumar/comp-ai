import { IsOptional, IsString, IsNumber, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class MonitorAlertQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: ['BUDGET_DRIFT', 'POLICY_VIOLATION', 'OUTLIER', 'EXEC_SUMMARY'],
  })
  @IsOptional()
  @IsString()
  alertType?: string;

  @ApiPropertyOptional({
    enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
  })
  @IsOptional()
  @IsString()
  severity?: string;
}

export class TriggerMonitorDto {
  @ApiPropertyOptional({
    description: 'Budget drift threshold percentage (default: 5)',
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  driftThresholdPct?: number;
}

