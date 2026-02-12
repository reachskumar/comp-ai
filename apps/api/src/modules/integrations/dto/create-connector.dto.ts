import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsObject,
} from 'class-validator';

export class CreateConnectorDto {
  @ApiProperty({ description: 'Connector name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Connector type',
    enum: ['HRIS', 'PAYROLL', 'BENEFITS', 'SSO', 'CUSTOM'],
  })
  @IsEnum(['HRIS', 'PAYROLL', 'BENEFITS', 'SSO', 'CUSTOM'])
  connectorType!: string;

  @ApiPropertyOptional({ description: 'Connector configuration (JSON)' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Connector credentials (will be encrypted)' })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Sync direction',
    enum: ['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL'],
    default: 'INBOUND',
  })
  @IsOptional()
  @IsEnum(['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL'])
  syncDirection?: string;

  @ApiPropertyOptional({
    description: 'Sync schedule',
    enum: ['REALTIME', 'HOURLY', 'DAILY', 'MANUAL'],
    default: 'MANUAL',
  })
  @IsOptional()
  @IsEnum(['REALTIME', 'HOURLY', 'DAILY', 'MANUAL'])
  syncSchedule?: string;

  @ApiPropertyOptional({
    description: 'Conflict resolution strategy',
    enum: ['LAST_WRITE_WINS', 'MANUAL_REVIEW', 'SOURCE_PRIORITY'],
    default: 'LAST_WRITE_WINS',
  })
  @IsOptional()
  @IsEnum(['LAST_WRITE_WINS', 'MANUAL_REVIEW', 'SOURCE_PRIORITY'])
  conflictStrategy?: string;

  @ApiPropertyOptional({ description: 'Additional metadata (JSON)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

