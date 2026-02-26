import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExchangeRateDto {
  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  fromCurrency!: string;

  @ApiProperty({ example: 'EUR' })
  @IsString()
  @IsNotEmpty()
  toCurrency!: string;

  @ApiProperty({ example: 0.92 })
  @IsNumber()
  rate!: number;

  @ApiPropertyOptional({ example: '2026-02-26T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({ enum: ['MANUAL', 'ECB', 'OPENEXCHANGE'], example: 'MANUAL' })
  @IsOptional()
  @IsEnum(['MANUAL', 'ECB', 'OPENEXCHANGE'] as const)
  source?: string;
}

export class UpdateTenantCurrencyDto {
  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @ApiPropertyOptional({ example: ['USD', 'EUR', 'GBP', 'INR'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedCurrencies?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  displayFormat?: Record<string, unknown>;
}

export class ConvertQueryDto {
  @ApiProperty({ example: 1000 })
  @IsNumber()
  amount!: number;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  from!: string;

  @ApiProperty({ example: 'EUR' })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiPropertyOptional({ example: '2026-02-26' })
  @IsOptional()
  @IsDateString()
  date?: string;
}
