import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';

export class ApproveImportDto {
  @ApiPropertyOptional({ description: 'Whether to approve or reject the import', default: true })
  @IsOptional()
  @IsBoolean()
  approve?: boolean = true;
}

