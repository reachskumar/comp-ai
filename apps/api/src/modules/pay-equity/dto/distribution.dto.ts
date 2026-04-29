import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSubscriptionDto {
  @ApiProperty({
    description: "Report type or 'digest' for the daily CHRO summary.",
    enum: ['board', 'eu_ptd', 'uk_gpg', 'eeo1', 'sb1162', 'auditor', 'defensibility', 'digest'],
  })
  @IsString()
  reportType!: string;

  @ApiProperty({ enum: ['daily', 'weekly', 'monthly', 'quarterly'] })
  @IsIn(['daily', 'weekly', 'monthly', 'quarterly'])
  cadence!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsEmail({}, { each: true })
  recipients!: string[];

  @ApiPropertyOptional({ description: 'Slack incoming-webhook URL (digests only).' })
  @IsOptional()
  @IsUrl()
  slackWebhook?: string;
}

export class CreateShareTokenDto {
  @ApiProperty()
  @IsString()
  runId!: string;

  @ApiProperty({ enum: ['auditor', 'defensibility', 'methodology'] })
  @IsIn(['auditor', 'defensibility', 'methodology'])
  scope!: string;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class RunSubscriptionsDto {
  @ApiPropertyOptional({ description: 'Optional override for testing — caller-supplied "now".' })
  @IsOptional()
  @IsString()
  now?: string;

  // Placeholder so the class isn't empty (some validation pipelines reject empty).
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  ids?: string[];
}
