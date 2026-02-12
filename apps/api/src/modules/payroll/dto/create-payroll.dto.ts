import { IsString, IsNotEmpty, IsArray, ValidateNested, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class PayrollLineItemDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ example: 'BASE_SALARY', description: 'Payroll component name' })
  @IsString()
  @IsNotEmpty()
  component!: string;

  @ApiProperty({ example: 5000, description: 'Current amount' })
  @IsNumber()
  amount!: number;

  @ApiPropertyOptional({ example: 4800, description: 'Previous period amount' })
  @IsOptional()
  @IsNumber()
  previousAmount?: number;
}

export class CreatePayrollDto {
  @ApiProperty({ example: '2026-01', description: 'Payroll period (e.g. YYYY-MM)' })
  @IsString()
  @IsNotEmpty()
  period!: string;

  @ApiProperty({ type: [PayrollLineItemDto], description: 'Line items to import' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollLineItemDto)
  lineItems!: PayrollLineItemDto[];
}

