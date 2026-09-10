import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

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

// ---------------------------------------------------------------------------
// Üyelik (rol) yönetimi
// ---------------------------------------------------------------------------

export class MembershipInputDto {
  @ApiProperty({ example: 'receptionist', description: 'Kiracı rolü — platform rolü atanamaz' })
  @IsString()
  @IsNotEmpty()
  roleKey: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Şube kapsamlı roller için ZORUNLU, kiracı kapsamlı roller için gönderilmemeli',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

/**
 * TAM DEĞİŞTİRME — `PUT /branches/:id/hours` ve `PUT /staff/:id/services` ile
 * aynı idiom. Listede olmayan üyelik PASİFE ALINIR.
 *
 * `PATCH` ile tek tek eklemek/çıkarmak yerine bunun seçilmesinin sebebi:
 * "kullanıcının rolü ne" sorusunun cevabı tek bir satır değil, bir KÜME. İki
 * ayrı çağrıyla yürütülen bir rol değişimi (önce ekle, sonra sil) arada
 * kullanıcıya iki rolü birden veren bir pencere bırakırdı.
 *
 * Boş liste geçerlidir ve "kullanıcıyı klinikten çıkar" demektir: üyeliği
 * kalmayan kullanıcı `GET /users/:id`te de görünmez olur. Geri alınması yeni
 * bir davet gerektirir.
 */
export class PutMembershipsDto {
  @ApiProperty({ type: [MembershipInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MembershipInputDto)
  memberships: MembershipInputDto[];
}

export class MembershipListResponseDto {
  @ApiProperty({ type: [MembershipResponseDto] })
  data: MembershipResponseDto[];
}
