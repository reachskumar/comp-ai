import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsArray } from 'class-validator';
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
  newTitle?: string;

  @ApiPropertyOptional({ description: 'New level (for promotions)' })
  @IsString()
  @IsOptional()
  newLevel?: string;

  @ApiPropertyOptional({ description: 'Effective date (ISO string)' })
  @IsString()
  @IsOptional()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Total compensation amount' })
  @IsNumber()
  @IsOptional()
  totalComp?: number;

  @ApiPropertyOptional({ description: 'List of benefits to include' })
  @IsArray()
  @IsOptional()
  benefits?: string[];

  @ApiPropertyOptional({ description: 'Additional notes for the letter' })
  @IsString()
  @IsOptional()
  additionalNotes?: string;

  @ApiPropertyOptional({ description: 'Tone of the letter', default: 'professional' })
  @IsString()
  @IsOptional()
  tone?: string;

  @ApiPropertyOptional({ description: 'Language code', default: 'en' })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ description: 'Custom instructions for AI' })
  @IsString()
  @IsOptional()
  customInstructions?: string;
}

