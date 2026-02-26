import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeEmployeeDto {
  @ApiProperty({ description: 'Employee ID to analyze' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;
}
