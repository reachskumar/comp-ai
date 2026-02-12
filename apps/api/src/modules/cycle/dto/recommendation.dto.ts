import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateRecommendationDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({
    example: 'MERIT_INCREASE',
    enum: ['MERIT_INCREASE', 'BONUS', 'LTI_GRANT', 'PROMOTION', 'ADJUSTMENT'],
  })
  @IsString()
  @IsNotEmpty()
  recType!: string;

  @ApiProperty({ example: 100000, description: 'Current compensation value' })
  @IsNumber()
  currentValue!: number;

  @ApiProperty({ example: 105000, description: 'Proposed compensation value' })
  @IsNumber()
  proposedValue!: number;

  @ApiPropertyOptional({ description: 'Justification for the recommendation' })
  @IsOptional()
  @IsString()
  justification?: string;

  @ApiPropertyOptional({ description: 'Approver user ID' })
  @IsOptional()
  @IsString()
  approverUserId?: string;
}

export class BulkCreateRecommendationDto {
  @ApiProperty({ type: [CreateRecommendationDto], description: 'Array of recommendations to create/update' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRecommendationDto)
  recommendations!: CreateRecommendationDto[];
}

export class UpdateRecommendationStatusDto {
  @ApiProperty({
    example: 'APPROVED',
    enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ESCALATED'],
  })
  @IsString()
  @IsNotEmpty()
  status!: string;

  @ApiPropertyOptional({ description: 'Reason for status change' })
  @IsOptional()
  @IsString()
  reason?: string;
}

