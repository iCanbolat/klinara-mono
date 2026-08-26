import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

/**
 * OpenAPI dokümanı — controller ve DTO tanımlarından ÜRETİLİR.
 *
 * Elle yazılan API dokümanı gerçekle er ya da geç ayrışır. Burada tek kaynak
 * kodun kendisidir: bir uca DTO/`@ApiProperty` eklenmezse dokümanda da eksik
 * görünür, bu da eksikliği fark etmenin en kolay yoludur.
 */
export function setupSwagger(app: INestApplication, version: string): void {
  const config = new DocumentBuilder()
    .setTitle('Klinara API')
    .setDescription(
      "Medikal estetik, güzellik ve diş/tıp klinikleri için randevu ve klinik yönetim API'si.",
    )
    .setVersion(version)
    .addServer('/', 'Geçerli sunucu')
    .addTag('system', 'Sağlık, hazırlık ve metrikler')
    .addTag('tenancy', 'Kiracı ve şube yönetimi')
    .addTag('auth', 'Giriş, oturum, 2FA, telefon doğrulama ve passkey')
    .addTag('identity', 'Kullanıcılar, roller ve davetler')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearerAuth')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    // Spec'i makineyle tüketilebilir biçimde de yayınla (istemci üretimi,
    // sözleşme testleri).
    jsonDocumentUrl: 'openapi.json',
    customSiteTitle: 'Klinara API',
  });
}
