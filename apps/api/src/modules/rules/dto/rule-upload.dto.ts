import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveRuleUploadDto {
  @ApiPropertyOptional({ description: 'Custom name for the created rule set' })
  @IsString()
  @IsOptional()
  ruleSetName?: string;
}
