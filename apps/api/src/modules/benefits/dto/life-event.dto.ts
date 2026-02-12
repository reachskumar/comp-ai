import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum LifeEventTypeDto {
  MARRIAGE = 'MARRIAGE',
  BIRTH = 'BIRTH',
  ADOPTION = 'ADOPTION',
  DIVORCE = 'DIVORCE',
  LOSS_OF_COVERAGE = 'LOSS_OF_COVERAGE',
  ADDRESS_CHANGE = 'ADDRESS_CHANGE',
}

export class CreateLifeEventDto {
  @ApiProperty({ example: 'clxyz123' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ enum: LifeEventTypeDto, example: 'MARRIAGE' })
  @IsEnum(LifeEventTypeDto)
  eventType!: LifeEventTypeDto;

  @ApiProperty({ example: '2026-03-15T00:00:00Z' })
  @IsDateString()
  eventDate!: string;

  @ApiProperty({ example: '2026-03-15T00:00:00Z', description: 'Date that qualifies for special enrollment' })
  @IsDateString()
  qualifyingDate!: string;

  @ApiPropertyOptional({ example: 'Got married on March 15' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class ReviewLifeEventDto {
  @ApiProperty({ enum: ['APPROVED', 'DENIED'], example: 'APPROVED' })
  @IsString()
  @IsNotEmpty()
  status!: 'APPROVED' | 'DENIED';
}

