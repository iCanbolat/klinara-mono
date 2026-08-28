import { Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { Public } from '../../common/decorators/auth.decorators';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@ApiTags('integrations')
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly webhook: WhatsAppWebhookService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Meta webhook doğrulaması (hub.challenge)',
    description: 'Meta webhook’u kaydederken bir kez çağırır; `hub.verify_token` env ile karşılaştırılır.',
  })
  verify(
    // Meta parametreleri NOKTALI gönderir (`hub.mode`); bir DTO sınıfı bunları
    // olduğu gibi eşleyemezdi, bu yüzden tek tek okunuyor.
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    return this.webhook.verifyChallenge({ mode, token, challenge });
  }

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<{ received: true; duplicate: boolean }> {
    // ⚠️ `request.rawBody` — parse edilmiş gövde DEĞİL. İmza ham baytlar
    // üzerinden hesaplanıyor; `JSON.stringify(request.body)` alan sırası ve
    // kaçış farkları yüzünden BAŞKA bir imza üretir ve doğrulama sessizce
    // başarısız olur.
    const raw = request.rawBody;
    if (raw === undefined) {
      throw new AppError(
        500,
        ERROR_CODES.INTERNAL_ERROR,
        'Ham gövde okunamadı (rawBody kapalı)',
      );
    }

    const result = await this.webhook.handle(raw, signature);
    // Meta 200 dışında her yanıtta olayı YENİDEN gönderir; tekrar eden olay
    // zaten idempotent işleniyor, dolayısıyla burada 200 dönmek doğru.
    return { received: true, duplicate: result.duplicate };
  }
}
