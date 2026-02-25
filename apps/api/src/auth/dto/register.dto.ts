import { IsEmail, IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'test@acme.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'StrongPass1!xy',
    description:
      'Min 12 chars, at least 1 uppercase, 1 lowercase, 1 number, 1 special character',
  })
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  @Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  @Matches(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
  @Matches(/[0-9]/, { message: 'Password must contain at least one number' })
  @Matches(/[^A-Za-z0-9]/, { message: 'Password must contain at least one special character' })
  password!: string;

  @ApiProperty({ example: 'Test User' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @IsNotEmpty()
  tenantName!: string;
}

