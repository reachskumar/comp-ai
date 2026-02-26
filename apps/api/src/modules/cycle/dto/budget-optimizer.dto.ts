import { IsNumber, IsOptional, IsArray, IsString, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class BudgetConstraintsDto {
  @ApiPropertyOptional({ example: 10000, description: 'Minimum budget per department' })
  @IsOptional()
  @IsNumber()
  minPerDept?: number;

  @ApiPropertyOptional({ example: 500000, description: 'Maximum budget per department' })
  @IsOptional()
  @IsNumber()
  maxPerDept?: number;

  @ApiPropertyOptional({ example: ['Engineering', 'Sales'], description: 'Priority departments' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  priorityDepartments?: string[];
}

export class BudgetOptimizeDto {
  @ApiProperty({ example: 1000000, description: 'Total budget to allocate' })
  @IsNumber()
  totalBudget!: number;

  @ApiPropertyOptional({ type: BudgetConstraintsDto, description: 'Optional constraints' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetConstraintsDto)
  constraints?: BudgetConstraintsDto;
}

class AllocationItemDto {
  @ApiProperty({ example: 'Engineering' })
  @IsString()
  department!: string;

  @ApiProperty({ example: 300000 })
  @IsNumber()
  amount!: number;
}

export class ApplyBudgetAllocationDto {
  @ApiProperty({ type: [AllocationItemDto], description: 'Allocations to apply' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  allocations!: AllocationItemDto[];
}
