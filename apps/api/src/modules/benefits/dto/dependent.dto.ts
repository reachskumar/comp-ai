import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEnum,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DependentRelationshipDto {
  SPOUSE = 'SPOUSE',
  CHILD = 'CHILD',
  DOMESTIC_PARTNER = 'DOMESTIC_PARTNER',
}

export class CreateDependentDto {
  @ApiProperty({ example: 'clxyz123' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({ enum: DependentRelationshipDto, example: 'SPOUSE' })
  @IsEnum(DependentRelationshipDto)
  relationship!: DependentRelationshipDto;

  @ApiProperty({ example: '1990-05-15T00:00:00Z' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiPropertyOptional({ example: '123-45-6789', description: 'SSN (will be encrypted at rest)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3}-\d{2}-\d{4}$/, { message: 'SSN must be in format XXX-XX-XXXX' })
  ssn?: string;

  @ApiPropertyOptional({ example: 'clxyz789', description: 'Link to an enrollment' })
  @IsOptional()
  @IsString()
  enrollmentId?: string;
}

export class UpdateDependentDto {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ enum: DependentRelationshipDto })
  @IsOptional()
  @IsEnum(DependentRelationshipDto)
  relationship?: DependentRelationshipDto;

  @ApiPropertyOptional({ example: '1990-05-15T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: '123-45-6789' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3}-\d{2}-\d{4}$/, { message: 'SSN must be in format XXX-XX-XXXX' })
  ssn?: string;
}

