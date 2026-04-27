import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLetterSignatureDto {
  @ApiPropertyOptional({ description: 'Signature display name (e.g. "Sachin Bajaj")' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Signature title (e.g. "Founder & CEO")' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
