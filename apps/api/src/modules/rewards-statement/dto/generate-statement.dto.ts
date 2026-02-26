import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateStatementDto {
  @ApiProperty({ description: 'Employee ID to generate statement for' })
  @IsString()
  employeeId!: string;

  @ApiPropertyOptional({ description: 'Year for the statement (defaults to current year)' })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2030)
  year?: number;
}
