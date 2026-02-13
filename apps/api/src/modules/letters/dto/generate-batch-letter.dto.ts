import { IsArray, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LetterTypeDto } from './generate-letter.dto';

export class GenerateBatchLetterDto {
  @ApiProperty({ description: 'Array of employee IDs', type: [String] })
  @IsArray()
  @IsNotEmpty()
  employeeIds!: string[];

  @ApiProperty({ enum: LetterTypeDto, description: 'Type of compensation letter' })
  @IsEnum(LetterTypeDto)
  letterType!: LetterTypeDto;

  @ApiPropertyOptional({ description: 'Salary increase percentage (applied to all)' })
  @IsNumber()
  @IsOptional()
  salaryIncreasePercent?: number;

  @ApiPropertyOptional({ description: 'Bonus amount (applied to all)' })
  @IsNumber()
  @IsOptional()
  bonusAmount?: number;

  @ApiPropertyOptional({ description: 'Effective date (ISO string)' })
  @IsString()
  @IsOptional()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Tone of the letter', default: 'professional' })
  @IsString()
  @IsOptional()
  tone?: string;

  @ApiPropertyOptional({ description: 'Language code', default: 'en' })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ description: 'Additional notes for the letter' })
  @IsString()
  @IsOptional()
  additionalNotes?: string;
}

