import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsObject,
  IsBoolean,
} from 'class-validator';

export class CreateFieldMappingDto {
  @ApiProperty({ description: 'Connector ID' })
  @IsString()
  @IsNotEmpty()
  connectorId!: string;

  @ApiProperty({ description: 'Source field path (e.g., "employee.first_name")' })
  @IsString()
  @IsNotEmpty()
  sourceField!: string;

  @ApiProperty({ description: 'Target field path (e.g., "firstName")' })
  @IsString()
  @IsNotEmpty()
  targetField!: string;

  @ApiPropertyOptional({
    description: 'Transform type',
    enum: [
      'direct', 'date_format', 'currency', 'enum_map',
      'concatenate', 'split', 'uppercase', 'lowercase',
      'trim', 'default', 'lookup',
    ],
    default: 'direct',
  })
  @IsOptional()
  @IsEnum([
    'direct', 'date_format', 'currency', 'enum_map',
    'concatenate', 'split', 'uppercase', 'lowercase',
    'trim', 'default', 'lookup',
  ])
  transformType?: string;

  @ApiPropertyOptional({ description: 'Transform configuration (JSON)' })
  @IsOptional()
  @IsObject()
  transformConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Whether this field is required', default: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ description: 'Default value if source is empty' })
  @IsOptional()
  @IsString()
  defaultValue?: string;
}

