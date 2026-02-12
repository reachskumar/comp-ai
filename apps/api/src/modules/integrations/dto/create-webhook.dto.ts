import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  IsUrl,
  ArrayMinSize,
} from 'class-validator';

export class CreateWebhookDto {
  @ApiProperty({ description: 'Connector ID' })
  @IsString()
  @IsNotEmpty()
  connectorId!: string;

  @ApiProperty({ description: 'Webhook URL (must be HTTPS for outbound)' })
  @IsString()
  @IsNotEmpty()
  url!: string;

  @ApiPropertyOptional({
    description: 'Webhook direction',
    enum: ['inbound', 'outbound'],
    default: 'inbound',
  })
  @IsOptional()
  @IsEnum(['inbound', 'outbound'])
  direction?: string;

  @ApiProperty({ description: 'Events to subscribe to', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events!: string[];
}

