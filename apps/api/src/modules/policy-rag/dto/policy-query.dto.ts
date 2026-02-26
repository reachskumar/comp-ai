import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PolicyQueryDto {
  @ApiPropertyOptional({ description: 'Filter by status', example: 'READY' })
  @IsString()
  @IsOptional()
  status?: string;
}
