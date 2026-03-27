import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  MinLength,
  Matches,
} from 'class-validator';

export class CreateTenantDto {
  @ApiProperty({ description: 'Company name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'URL-safe slug (auto-generated if omitted)' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message: 'Slug must be lowercase alphanumeric with hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({ description: 'Subdomain override' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message: 'Subdomain must be lowercase alphanumeric with hyphens',
  })
  subdomain?: string;

  @ApiPropertyOptional({ description: 'Plan tier', default: 'free' })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ description: 'Compport Cloud SQL schema name' })
  @IsOptional()
  @IsString()
  compportSchema?: string;
}

export class UpdateTenantDto {
  @ApiPropertyOptional({ description: 'Company name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Subdomain' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message: 'Subdomain must be lowercase alphanumeric with hyphens',
  })
  subdomain?: string;

  @ApiPropertyOptional({ description: 'Custom domain (e.g., compportiq.sb.ai)' })
  @IsOptional()
  @IsString()
  customDomain?: string;

  @ApiPropertyOptional({ description: 'Logo URL' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Brand accent color (hex)' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'primaryColor must be a valid hex color' })
  primaryColor?: string;

  @ApiPropertyOptional({ description: 'Plan tier' })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Compport Cloud SQL schema name' })
  @IsOptional()
  @IsString()
  compportSchema?: string;
}

export class CreateTenantUserDto {
  @ApiProperty({ description: 'User email' })
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ description: 'User name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'User role', default: 'ADMIN' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({
    description: 'User password (min 8 chars). If omitted, user is invite-based.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class OnboardTenantDto {
  @ApiProperty({ description: 'Compport Cloud SQL schema name' })
  @IsString()
  @IsNotEmpty()
  compportSchema!: string;

  @ApiProperty({ description: 'Company name' })
  @IsString()
  @IsNotEmpty()
  companyName!: string;

  @ApiPropertyOptional({ description: 'Subdomain override' })
  @IsOptional()
  @IsString()
  subdomain?: string;

  @ApiPropertyOptional({ description: 'Admin user email' })
  @IsOptional()
  @IsString()
  adminEmail?: string;

  @ApiPropertyOptional({ description: 'Admin user name' })
  @IsOptional()
  @IsString()
  adminName?: string;

  @ApiPropertyOptional({
    description: 'Admin user password (min 8 chars). If omitted, user is invite-based.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  adminPassword?: string;

  @ApiPropertyOptional({
    description: 'Admin user role',
    default: 'ADMIN',
    enum: ['ADMIN', 'HR_MANAGER', 'MANAGER', 'ANALYST', 'EMPLOYEE'],
  })
  @IsOptional()
  @IsString()
  adminRole?: string;
}
