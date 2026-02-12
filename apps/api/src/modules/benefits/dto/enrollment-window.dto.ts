import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsNumber,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum EnrollmentWindowStatusDto {
  UPCOMING = 'UPCOMING',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export class CreateEnrollmentWindowDto {
  @ApiProperty({ example: 'Open Enrollment 2026' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 2026 })
  @IsNumber()
  @Type(() => Number)
  planYear!: number;

  @ApiProperty({ example: '2025-11-01T00:00:00Z' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2025-11-30T00:00:00Z' })
  @IsDateString()
  endDate!: string;
}

export class UpdateEnrollmentWindowDto extends PartialType(CreateEnrollmentWindowDto) {
  @ApiPropertyOptional({ enum: EnrollmentWindowStatusDto })
  @IsOptional()
  @IsEnum(EnrollmentWindowStatusDto)
  status?: EnrollmentWindowStatusDto;
}

