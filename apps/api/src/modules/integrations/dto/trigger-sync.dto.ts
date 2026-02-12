import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString, IsInt, Min, Max } from 'class-validator';

export class TriggerSyncDto {
  @ApiProperty({ description: 'Entity type to sync (e.g., "employees", "departments")' })
  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @ApiPropertyOptional({
    description: 'Sync direction override',
    enum: ['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL'],
  })
  @IsOptional()
  @IsEnum(['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL'])
  direction?: string;

  @ApiPropertyOptional({ description: 'Only sync records changed after this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  since?: string;

  @ApiPropertyOptional({ description: 'Batch size for processing', default: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  batchSize?: number;
}

