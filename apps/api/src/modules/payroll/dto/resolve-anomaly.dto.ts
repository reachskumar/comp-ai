import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveAnomalyDto {
  @ApiProperty({ description: 'Resolution notes explaining how the anomaly was resolved' })
  @IsString()
  @IsNotEmpty()
  resolutionNotes!: string;
}

