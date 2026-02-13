import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RunSimulationDto {
  @ApiProperty({ description: 'Natural language scenario description', example: 'Give 5% merit to all Engineering' })
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ApiPropertyOptional({ description: 'Optional name for the scenario' })
  @IsOptional()
  @IsString()
  name?: string;
}

export class CompareSimulationsDto {
  @ApiProperty({ description: 'First scenario prompt', example: 'Give 5% merit to all Engineering' })
  @IsString()
  @IsNotEmpty()
  promptA!: string;

  @ApiProperty({ description: 'Second scenario prompt', example: 'Give 3% merit to all Engineering and 10% bonus to top performers' })
  @IsString()
  @IsNotEmpty()
  promptB!: string;

  @ApiPropertyOptional({ description: 'Optional name for the comparison' })
  @IsOptional()
  @IsString()
  name?: string;
}

