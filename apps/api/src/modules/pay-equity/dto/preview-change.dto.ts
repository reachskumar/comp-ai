import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ChangeItemDto {
  @ApiProperty({ enum: ['promotion', 'salary_change', 'new_hire'] })
  @IsIn(['promotion', 'salary_change', 'new_hire'])
  kind!: 'promotion' | 'salary_change' | 'new_hire';

  @ApiPropertyOptional({ description: 'Required for promotion + salary_change.' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  fromSalary?: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  toSalary!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  level?: string;

  @ApiPropertyOptional({ description: 'Required for new_hire when no employeeId.' })
  @IsOptional()
  @IsString()
  dimension?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  group?: string;
}

export class PreviewChangeDto {
  @ApiProperty({ type: [ChangeItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChangeItemDto)
  changes!: ChangeItemDto[];
}
