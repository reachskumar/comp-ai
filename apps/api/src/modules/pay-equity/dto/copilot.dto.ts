import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AskCopilotDto {
  @ApiProperty({
    description: "Manager's question. Bounded scope: their team or org-wide PE findings.",
    example: 'Is anyone on my team underpaid relative to their L4 cohort?',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  question!: string;
}
