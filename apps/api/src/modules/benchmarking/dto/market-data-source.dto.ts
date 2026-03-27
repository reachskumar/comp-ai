import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMarketDataSourceDto {
  @ApiProperty({ example: 'Radford Global Technology Survey' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'MERCER',
    enum: [
      'MANUAL',
      'SURVEY',
      'API',
      'RADFORD',
      'MERCER',
      'WTW',
      'AON',
      'KORN_FERRY',
      'PAYSCALE',
      'SALARY_COM',
      'COMP_ANALYST',
      'CUSTOM',
    ],
  })
  @IsEnum([
    'MANUAL',
    'SURVEY',
    'API',
    'RADFORD',
    'MERCER',
    'WTW',
    'AON',
    'KORN_FERRY',
    'PAYSCALE',
    'SALARY_COM',
    'COMP_ANALYST',
    'CUSTOM',
  ])
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
