import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateJobLevelDto {
  @ApiProperty({ example: 'Senior Engineer' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'ENG-L4' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ example: 4 })
  @IsNumber()
  grade!: number;

  @ApiPropertyOptional({ example: 'Senior individual contributor' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 120000 })
  @IsNumber()
  minSalary!: number;

  @ApiProperty({ example: 150000 })
  @IsNumber()
  midSalary!: number;

  @ApiProperty({ example: 180000 })
  @IsNumber()
  maxSalary!: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: ['System Design', 'Mentoring', 'Code Review'] })
  @IsOptional()
  @IsArray()
  competencies?: string[];

  @ApiPropertyOptional({ example: 'clxyz123' })
  @IsOptional()
  @IsString()
  nextLevelId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateJobLevelDto extends PartialType(CreateJobLevelDto) {}

export class JobLevelQueryDto {
  @ApiPropertyOptional({ example: 'clxyz123' })
  @IsOptional()
  @IsString()
  jobFamilyId?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  grade?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  isActive?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  limit?: string;
}

export class AssignEmployeesDto {
  @ApiProperty({ example: ['emp1', 'emp2'] })
  @IsArray()
  @IsString({ each: true })
  employeeIds!: string[];
}
