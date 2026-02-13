import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateReportDto {
  @ApiProperty({ description: 'Natural language report request', example: 'Show average salary by department' })
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ApiPropertyOptional({ description: 'Conversation ID for follow-up queries' })
  @IsString()
  @IsOptional()
  conversationId?: string;
}

export class ExportReportDto {
  @ApiProperty({ description: 'Export format', example: 'csv', enum: ['csv', 'pdf', 'excel'] })
  @IsString()
  @IsNotEmpty()
  format!: string;
}

