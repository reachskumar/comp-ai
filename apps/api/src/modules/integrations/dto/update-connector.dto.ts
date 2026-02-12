import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsObject } from 'class-validator';

export class UpdateConnectorDto {
  @ApiPropertyOptional({ description: 'Connector name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Connector configuration (JSON)' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'New credentials (will be encrypted)' })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Connector status',
    enum: ['ACTIVE', 'INACTIVE', 'ERROR', 'PENDING'],
  })
  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE', 'ERROR', 'PENDING'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Sync direction',
    enum: ['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL'],
  })
  @IsOptional()
  @IsEnum(['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL'])
  syncDirection?: string;

  @ApiPropertyOptional({
    description: 'Sync schedule',
    enum: ['REALTIME', 'HOURLY', 'DAILY', 'MANUAL'],
  })
  @IsOptional()
  @IsEnum(['REALTIME', 'HOURLY', 'DAILY', 'MANUAL'])
  syncSchedule?: string;

  @ApiPropertyOptional({
    description: 'Conflict resolution strategy',
    enum: ['LAST_WRITE_WINS', 'MANUAL_REVIEW', 'SOURCE_PRIORITY'],
  })
  @IsOptional()
  @IsEnum(['LAST_WRITE_WINS', 'MANUAL_REVIEW', 'SOURCE_PRIORITY'])
  conflictStrategy?: string;

  @ApiPropertyOptional({ description: 'Additional metadata (JSON)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

