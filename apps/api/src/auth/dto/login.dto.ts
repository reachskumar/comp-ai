import { IsEmail, IsString, IsOptional, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'test@acme.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Test1234!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({ example: 'bfl', description: 'Tenant slug from subdomain (optional)' })
  @IsString()
  @IsOptional()
  tenantSlug?: string;
}

