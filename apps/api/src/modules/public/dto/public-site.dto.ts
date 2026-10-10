import { ApiProperty } from '@nestjs/swagger';

export class HostResolutionDto {
  @ApiProperty({ example: 'klinik-x', description: 'Randevu sayfasının slug’ı' })
  slug: string;

  @ApiProperty({
    example: 'https://randevu.klinikx.com',
    description: 'Kiracının birincil adresi — `<link rel="canonical">` ve 301 için.',
  })
  canonicalUrl: string;

  @ApiProperty({
    example: 'https://klinara.app/randevu?klinik=klinik-x',
    nullable: true,
    type: String,
    description:
      'Sayfası yayında olmayan kliniğin platform subdomain’i için doğrudan randevu bağlantısı; web buraya yönlendirir. Aksi hâlde `null`.',
  })
  directUrl: string | null;
}

export class EdgeAuthorizationDto {
  @ApiProperty({
    example: true,
    description:
      'Kenar proxy’si bu konak adı için sertifika alabilir mi. Gövde kiracı adı ya da slug TAŞIMAZ.',
  })
  authorized: boolean;
}
