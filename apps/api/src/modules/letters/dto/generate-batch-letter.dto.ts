import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LetterTypeDto } from './generate-letter.dto';

export class GenerateBatchLetterDto {
  @ApiProperty({ description: 'Array of employee IDs (max 100 per batch)', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
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
  @MaxLength(64)
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Tone of the letter', default: 'professional' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  tone?: string;

  @ApiPropertyOptional({ description: 'Language code', default: 'en' })
  @IsString()
  @IsOptional()
  @MaxLength(16)
  language?: string;

  @ApiPropertyOptional({ description: 'Additional notes for the letter' })
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  additionalNotes?: string;
}
