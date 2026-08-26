import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const LOCALES = ['tr-TR', 'en-US'] as const;

export class MembershipResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  branchId: string | null;

  @ApiProperty({ example: 'receptionist' })
  roleKey: string;

  @ApiProperty({ example: 'Resepsiyon' })
  roleName: string;
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty()
  locale: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true, type: String, example: '+905321234567' })
  phone: string | null;

  /** Yalnız doğrulanmış numara giriş tanımlayıcısı olabilir. */
  @ApiProperty()
  phoneVerified: boolean;

  @ApiProperty({ description: 'Parola kurulu mu (davet bekleyen hesapta false)' })
  hasPassword: boolean;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastLoginAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: [MembershipResponseDto] })
  memberships: MembershipResponseDto[];
}

export class UserListResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  data: UserResponseDto[];
}

export class MeResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ type: [String] })
  roles: string[];

  /** İstemci menüyü buna göre kurar; yetki kontrolü yine SUNUCUDA yapılır. */
  @ApiProperty({ type: [String] })
  permissions: string[];

  @ApiProperty({ type: [String] })
  branchIds: string[];

  @ApiProperty({ description: 'Kiracı kapsamlı rol (tüm şubeler)' })
  tenantWide: boolean;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional({ enum: LOCALES })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: string;

  @ApiPropertyOptional({ description: 'Hesabı devre dışı bırakır (yalnız yönetici)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
