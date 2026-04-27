import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LetterApprovalChainStepDto {
  @ApiProperty({ description: 'Role identifier (matches user.role) — e.g. "HRBP", "CHRO".' })
  @IsString()
  @MaxLength(64)
  role!: string;

  @ApiProperty({ description: 'Display label for this step — e.g. "HR Business Partner".' })
  @IsString()
  @MaxLength(120)
  label!: string;
}

export class UpdateLetterApprovalChainDto {
  @ApiProperty({
    description: 'Ordered approval chain. Empty array clears the chain (single-step approve).',
    type: [LetterApprovalChainStepDto],
  })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => LetterApprovalChainStepDto)
  chain!: LetterApprovalChainStepDto[];
}
