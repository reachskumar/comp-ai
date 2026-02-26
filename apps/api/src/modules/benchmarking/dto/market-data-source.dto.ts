import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMarketDataSourceDto {
  @ApiProperty({ example: 'Radford Global Technology Survey' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'SURVEY', enum: ['MANUAL', 'SURVEY', 'API'] })
  @IsEnum(['MANUAL', 'SURVEY', 'API'])
  provider!: string;

  @ApiPropertyOptional({ description: 'Provider-specific configuration' })
  @IsOptional()
  config?: Record<string, unknown>;
}

export class UpdateMarketDataSourceDto {
  @ApiPropertyOptional({ example: 'Updated Source Name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'ERROR'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Provider-specific configuration' })
  @IsOptional()
  config?: Record<string, unknown>;
}
