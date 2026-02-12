import { IsOptional, IsArray, IsString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SimulationParamsDto {
  @ApiPropertyOptional({ example: ['Engineering', 'Sales'], description: 'Filter by departments' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  departmentFilter?: string[];

  @ApiPropertyOptional({ example: ['L4', 'L5'], description: 'Filter by levels' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  levelFilter?: string[];

  @ApiPropertyOptional({ example: ['US', 'UK'], description: 'Filter by locations' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationFilter?: string[];

  @ApiPropertyOptional({ example: 1000, description: 'Max employees to sample' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxEmployees?: number;
}

