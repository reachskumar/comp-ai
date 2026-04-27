import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum LetterTypeDto {
  OFFER = 'offer',
  RAISE = 'raise',
  PROMOTION = 'promotion',
  BONUS = 'bonus',
  TOTAL_COMP_SUMMARY = 'total_comp_summary',
}

export class GenerateLetterDto {
  @ApiProperty({ description: 'Employee ID to generate letter for' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  employeeId!: string;

  @ApiProperty({ enum: LetterTypeDto, description: 'Type of compensation letter' })
  @IsEnum(LetterTypeDto)
  letterType!: LetterTypeDto;

  @ApiPropertyOptional({ description: 'New salary amount' })
  @IsNumber()
  @IsOptional()
  newSalary?: number;

  @ApiPropertyOptional({ description: 'Salary increase amount' })
  @IsNumber()
  @IsOptional()
  salaryIncrease?: number;

  @ApiPropertyOptional({ description: 'Salary increase percentage' })
  @IsNumber()
  @IsOptional()
  salaryIncreasePercent?: number;

  @ApiPropertyOptional({ description: 'Bonus amount' })
  @IsNumber()
  @IsOptional()
  bonusAmount?: number;

  @ApiPropertyOptional({ description: 'New job title (for promotions)' })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  newTitle?: string;

  @ApiPropertyOptional({ description: 'New level (for promotions)' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  newLevel?: string;

  @ApiPropertyOptional({ description: 'Effective date (ISO string)' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Total compensation amount' })
  @IsNumber()
  @IsOptional()
  totalComp?: number;

  @ApiPropertyOptional({ description: 'List of benefits to include' })
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  benefits?: string[];

  @ApiPropertyOptional({ description: 'Additional notes for the letter' })
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  additionalNotes?: string;

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

  @ApiPropertyOptional({ description: 'Custom instructions for AI' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  customInstructions?: string;
}
