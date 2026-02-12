import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExchangeTokenDto {
  @ApiProperty({ description: 'Compport PHP session token (JWT)' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class SyncQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: 'Items per page', default: '100' })
  @IsOptional()
  @IsString()
  limit?: string;
}

