import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ description: 'The user message', example: 'How many employees do we have?' })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({ description: 'Conversation ID for continuity', example: 'conv-abc123' })
  @IsString()
  @IsOptional()
  conversationId?: string;
}

