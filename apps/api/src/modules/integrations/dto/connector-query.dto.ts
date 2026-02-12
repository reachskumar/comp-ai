import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, IsString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class ConnectorQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by connector type',
    enum: ['HRIS', 'PAYROLL', 'BENEFITS', 'SSO', 'CUSTOM'],
  })
  @IsOptional()
  @IsEnum(['HRIS', 'PAYROLL', 'BENEFITS', 'SSO', 'CUSTOM'])
  connectorType?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['ACTIVE', 'INACTIVE', 'ERROR', 'PENDING'],
  })
  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE', 'ERROR', 'PENDING'])
  status?: string;
}

export class SyncLogQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Filter by action',
    enum: ['CREATE', 'UPDATE', 'DELETE', 'SKIP', 'ERROR'],
  })
  @IsOptional()
  @IsEnum(['CREATE', 'UPDATE', 'DELETE', 'SKIP', 'ERROR'])
  action?: string;
}

