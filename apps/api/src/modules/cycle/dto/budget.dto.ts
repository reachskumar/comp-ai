import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SetBudgetDto {
  @ApiProperty({ example: 'Engineering' })
  @IsString()
  @IsNotEmpty()
  department!: string;

  @ApiPropertyOptional({ description: 'Manager ID for this budget allocation' })
  @IsOptional()
  @IsString()
  managerId?: string;

  @ApiProperty({ example: 500000, description: 'Allocated budget amount' })
  @IsNumber()
  allocated!: number;
}

export class BulkSetBudgetDto {
  @ApiProperty({ type: [SetBudgetDto], description: 'Array of department budget allocations' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetBudgetDto)
  budgets!: SetBudgetDto[];
}

export class BottomUpBudgetDto {
  @ApiProperty({ example: 'Engineering' })
  @IsString()
  @IsNotEmpty()
  department!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  managerId?: string;

  @ApiProperty({ example: 250000, description: 'Requested budget amount from manager' })
  @IsNumber()
  requested!: number;

  @ApiPropertyOptional({ description: 'Justification for the budget request' })
  @IsOptional()
  @IsString()
  justification?: string;
}

