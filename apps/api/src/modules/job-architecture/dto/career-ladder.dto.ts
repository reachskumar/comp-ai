import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateCareerLadderDto {
  @ApiProperty({ example: 'IC Engineering Track' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Individual contributor progression path' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: [
      {
        trackName: 'IC Track',
        levels: ['ENG-L1', 'ENG-L2', 'ENG-L3', 'ENG-L4', 'ENG-L5', 'ENG-L6'],
      },
    ],
  })
  @IsArray()
  tracks!: Array<{ trackName: string; levels: string[] }>;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCareerLadderDto extends PartialType(CreateCareerLadderDto) {}

export class CareerLadderQueryDto {
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
