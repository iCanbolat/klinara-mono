import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { WhatsAppService } from './whatsapp.service';
import {
  UpsertWhatsAppAccountDto,
  WhatsAppAccountResponseDto,
  WhatsAppTemplateResponseDto,
  WhatsAppTestResultDto,
  WhatsAppTestSendDto,
  WhatsAppVerifyResultDto,
} from './dto/whatsapp.dto';

@ApiTags('integrations')
@ApiBearerAuth('bearerAuth')
@Controller('integrations/whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get()
  @RequirePermission(PERMISSIONS.NOTIFICATION_MANAGE)
  @ApiOperation({
    summary: 'WhatsApp entegrasyon durumu',
    description: 'Erişim token’ı MASKELİ döner; ham değer hiçbir yanıtta bulunmaz.',
  })
  @ApiOkResponse({ type: WhatsAppAccountResponseDto })
  get(): Promise<WhatsAppAccountResponseDto | null> {
    return this.whatsapp.get();
  }

  @Put()
  @RequirePermission(PERMISSIONS.NOTIFICATION_MANAGE)
  @ApiOperation({
    summary: 'WhatsApp kimlik bilgilerini yaz',
    description: 'Token ve app secret AES-256-GCM ile şifreli saklanır. Yazım hesabı doğrulanmamış duruma düşürür.',
  })
  @ApiOkResponse({ type: WhatsAppAccountResponseDto })
  upsert(@Body() body: UpsertWhatsAppAccountDto): Promise<WhatsAppAccountResponseDto> {
    return this.whatsapp.upsert(body);
  }

  @Post('verify')
  @RequirePermission(PERMISSIONS.NOTIFICATION_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kimlik bilgilerini doğrula ve template listesini tazele',
    description: "Meta'dan template listesi çekilir; başarılıysa hesap `active` olur.",
  })
  @ApiOkResponse({ type: WhatsAppVerifyResultDto })
  verify(): Promise<WhatsAppVerifyResultDto> {
    return this.whatsapp.verify();
  }

  @Get('templates')
  @RequirePermission(PERMISSIONS.NOTIFICATION_READ)
  @ApiOperation({
    summary: 'Onaylı template listesi (Meta yansıması)',
    description: 'Gerçeğin kaynağı Meta’dır; buradaki liste son doğrulamada çekilmiştir.',
  })
  @ApiOkResponse({ type: [WhatsAppTemplateResponseDto] })
  templates(): Promise<WhatsAppTemplateResponseDto[]> {
    return this.whatsapp.listTemplates();
  }

  @Post('test')
  @RequirePermission(PERMISSIONS.NOTIFICATION_SEND)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test mesajı gönder (onaylı template ile)',
    description: 'Senkron çalışır ve kuyruğa iş bırakmaz — "çalışıyor mu?" sorusunun cevabıdır.',
  })
  @ApiOkResponse({ type: WhatsAppTestResultDto })
  test(@Body() body: WhatsAppTestSendDto): Promise<WhatsAppTestResultDto> {
    return this.whatsapp.testSend(body);
  }
}
