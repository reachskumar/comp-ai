import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveLetterDto {
  @ApiPropertyOptional({ description: 'Optional comment recorded with the approval.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class RejectLetterDto {
  @ApiPropertyOptional({ description: 'Reason for rejection (recommended).' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
