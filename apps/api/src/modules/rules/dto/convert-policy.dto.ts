import { IsString, IsNotEmpty, MinLength, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConvertPolicyDto {
  @ApiProperty({
    description: 'The compensation policy text to convert into rules',
    example:
      'Employees with performance rating of 4 or above receive a 5% merit increase. ' +
      'Employees in the Engineering department receive a 10% bonus.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  text!: string;

  @ApiPropertyOptional({ description: 'Original file name (set automatically for file uploads)' })
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiPropertyOptional({ description: 'File MIME type (set automatically for file uploads)' })
  @IsOptional()
  @IsString()
  fileType?: string;
}

export class UpdateConversionCountsDto {
  @ApiProperty({ description: 'Number of accepted rules' })
  @IsNumber()
  @Min(0)
  accepted!: number;

  @ApiProperty({ description: 'Number of rejected rules' })
  @IsNumber()
  @Min(0)
  rejected!: number;
}

