import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class BulkGenerateDto {
  @ApiPropertyOptional({ description: 'Filter by department (omit for all employees)' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Year for the statements (defaults to current year)' })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2030)
  year?: number;
}
