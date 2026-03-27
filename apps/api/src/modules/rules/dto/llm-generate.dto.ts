import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class LlmAnalyzeDto {
  @ApiPropertyOptional({ example: 'cly1234abc', description: 'Second rule set ID for comparison' })
  @IsOptional()
  @IsString()
  compareWithId?: string;
}

export class LlmGenerateDto {
  @ApiProperty({
    example:
      'Create a merit rule set that gives 5% to anyone rated 4+ with compa-ratio below 0.9, 3% for rating 3, and 0% for rating 1-2',
    description: 'Natural language instruction describing the rules to generate',
  })
  @IsString()
  @IsNotEmpty()
  instruction!: string;
}
