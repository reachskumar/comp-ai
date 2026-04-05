import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  ArrayMinSize,
} from 'class-validator';

export class UpdateWebhookDto {
  @ApiPropertyOptional({ description: 'Webhook URL (must be HTTPS for outbound)' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: 'Events to subscribe to', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional({ description: 'Whether the webhook is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
