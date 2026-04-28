import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListPayEquityRunsDto {
  @ApiPropertyOptional({ description: 'Filter by agent type.' })
  @IsOptional()
  @IsIn(['narrative', 'cohort_root_cause', 'remediation', 'projection'])
  agentType?: string;

  @ApiPropertyOptional({ description: 'Filter by status.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @ApiPropertyOptional({ description: 'Page number (1-indexed).', default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page (max 100).', default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
