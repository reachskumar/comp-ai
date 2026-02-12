import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsEnum,
  ValidateNested,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ApprovalDecisionDto {
  @ApiProperty({ description: 'Recommendation ID' })
  @IsString()
  @IsNotEmpty()
  recommendationId!: string;

  @ApiProperty({ enum: ['APPROVED', 'REJECTED'], description: 'Approval decision' })
  @IsEnum(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'Comment or justification for the decision' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class BulkApprovalDto {
  @ApiProperty({ type: [ApprovalDecisionDto], description: 'Array of approval decisions' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalDecisionDto)
  decisions!: ApprovalDecisionDto[];

  @ApiPropertyOptional({ description: 'Override justification (for exception approvals)' })
  @IsOptional()
  @IsString()
  overrideJustification?: string;
}

export class NudgeDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Specific approver user IDs to nudge. If empty, nudges all pending approvers.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  approverUserIds?: string[];

  @ApiPropertyOptional({ description: 'Custom message for the nudge notification' })
  @IsOptional()
  @IsString()
  message?: string;
}

export class PendingApprovalQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: ['SUBMITTED', 'ESCALATED'], description: 'Filter by recommendation status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by department' })
  @IsOptional()
  @IsString()
  department?: string;
}

