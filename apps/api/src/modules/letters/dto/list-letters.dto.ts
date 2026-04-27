import { IsOptional, IsString, IsEnum, IsInt, MaxLength, Max, Min } from 'class-validator';
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
  @MaxLength(32)
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by employee ID' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Filter by batch ID' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  batchId?: string;

  @ApiPropertyOptional({ description: 'Search subject or employee name' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
