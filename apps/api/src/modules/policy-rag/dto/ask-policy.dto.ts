import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AskPolicyDto {
  @ApiProperty({
    description: 'The question to ask about company policies',
    example: 'What is our merit increase policy?',
  })
  @IsString()
  @IsNotEmpty()
  question!: string;

  @ApiPropertyOptional({ description: 'Conversation ID for continuity', example: 'conv-abc123' })
  @IsString()
  @IsOptional()
  conversationId?: string;
}
