import { IsOptional, IsString, IsEnum, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { LetterTypeDto } from './generate-letter.dto';

export class ListLettersDto {
  @ApiPropertyOptional({ description: 'Filter by letter type' })
  @IsEnum(LetterTypeDto)
  @IsOptional()
  letterType?: LetterTypeDto;

  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by employee ID' })
  @IsString()
  @IsOptional()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Filter by batch ID' })
  @IsString()
  @IsOptional()
  batchId?: string;

  @ApiPropertyOptional({ description: 'Search in subject/content' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  limit?: number;
}

