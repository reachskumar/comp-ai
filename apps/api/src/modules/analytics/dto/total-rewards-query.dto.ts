import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum TotalRewardsView {
  PERSONAL = 'personal',
  TEAM = 'team',
}

export class TotalRewardsQueryDto {
  @ApiPropertyOptional({ description: 'View mode: personal or team (managers only)', enum: TotalRewardsView })
  @IsOptional()
  @IsEnum(TotalRewardsView)
  view?: TotalRewardsView;

  @ApiPropertyOptional({ description: 'Year for rewards data (defaults to current year)' })
  @IsOptional()
  @IsString()
  year?: string;
}

