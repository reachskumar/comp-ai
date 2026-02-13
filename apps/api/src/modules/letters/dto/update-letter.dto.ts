import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum LetterStatusDto {
  DRAFT = 'DRAFT',
  REVIEW = 'REVIEW',
  APPROVED = 'APPROVED',
  SENT = 'SENT',
}

export class UpdateLetterDto {
  @ApiPropertyOptional({ description: 'Updated letter subject' })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiPropertyOptional({ description: 'Updated letter content (markdown)' })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiPropertyOptional({ enum: LetterStatusDto, description: 'New status' })
  @IsEnum(LetterStatusDto)
  @IsOptional()
  status?: LetterStatusDto;
}

