import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}

