import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MatrixCellDto {
  @ApiProperty({ example: 3 })
  perfRating!: number;

  @ApiProperty({ example: '0.90-1.00' })
  compaRatioRange!: string;

  @ApiProperty({ example: 3.5 })
  increasePercent!: number;
}

export class CreateMeritMatrixDto {
  @ApiProperty({ example: 'FY2026 Merit Matrix' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({ type: [MatrixCellDto] })
  @IsArray()
  matrix!: MatrixCellDto[];
}

export class UpdateMeritMatrixDto {
  @ApiPropertyOptional({ example: 'Updated Merit Matrix' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: [MatrixCellDto] })
  @IsOptional()
  @IsArray()
  matrix?: MatrixCellDto[];
}

export class ApplyToCycleDto {
  @ApiPropertyOptional({ description: 'Optional: override compa-ratio ranges' })
  @IsOptional()
  compaRatioRanges?: string[];
}
