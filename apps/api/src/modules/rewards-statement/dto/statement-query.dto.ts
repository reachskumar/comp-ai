import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StatementQueryDto {
  @ApiPropertyOptional({ description: 'Filter by status: DRAFT, GENERATED, SENT, FAILED' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by employee ID' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Page number' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: 'Items per page' })
  @IsOptional()
  @IsString()
  limit?: string;
}
