import { ApiProperty } from '@nestjs/swagger';

export class HostResolutionDto {
  @ApiProperty({ example: 'klinik-x', description: 'Randevu sayfasının slug’ı' })
  slug: string;

  @ApiProperty({
    example: 'https://randevu.klinikx.com',
    description: 'Kiracının birincil adresi — `<link rel="canonical">` ve 301 için.',
  })
  canonicalUrl: string;
}

export class EdgeAuthorizationDto {
  @ApiProperty({
    example: true,
    description:
      'Kenar proxy’si bu konak adı için sertifika alabilir mi. Gövde kiracı adı ya da slug TAŞIMAZ.',
  })
  authorized: boolean;
}
