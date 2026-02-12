import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransitionCycleDto {
  @ApiProperty({
    example: 'PLANNING',
    enum: ['DRAFT', 'PLANNING', 'ACTIVE', 'CALIBRATION', 'APPROVAL', 'COMPLETED', 'CANCELLED'],
    description: 'Target status to transition to',
  })
  @IsString()
  @IsNotEmpty()
  targetStatus!: string;

  @ApiPropertyOptional({ description: 'Reason or comment for the transition' })
  @IsOptional()
  @IsString()
  reason?: string;
}

