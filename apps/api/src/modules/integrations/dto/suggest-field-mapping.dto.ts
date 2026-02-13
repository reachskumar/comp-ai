import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FieldSchemaDto {
  @ApiProperty({ description: 'Field name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Field type (string, number, date, enum, boolean)' })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ description: 'Whether the field is required' })
  @IsBoolean()
  required!: boolean;

  @ApiPropertyOptional({ description: 'Field description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Enum values', type: [String] })
  @IsOptional()
  @IsArray()
  enumValues?: string[];

  @ApiPropertyOptional({ description: 'Sample values', type: [String] })
  @IsOptional()
  @IsArray()
  sampleValues?: string[];
}

export class SuggestFieldMappingDto {
  @ApiPropertyOptional({ description: 'Connector template ID (e.g., "workday", "bamboohr")' })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional({ description: 'Connector type label (e.g., "Workday HCM")' })
  @IsOptional()
  @IsString()
  connectorType?: string;

  @ApiPropertyOptional({
    description: 'Custom source fields (used when templateId is not provided)',
    type: [FieldSchemaDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldSchemaDto)
  sourceFields?: FieldSchemaDto[];
}

