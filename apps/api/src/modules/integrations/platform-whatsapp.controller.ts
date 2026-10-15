import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppError } from '../../common/errors/app-error';
import { PlatformAdminOnly } from '../../common/decorators/auth.decorators';
import { RequestContextService } from '../../common/request-context';
import { TenantTxService } from '../../database/tenant-tx.service';
import * as tenancyRepo from '../tenancy/tenancy.repository';
import {
  PlatformWhatsAppDto,
  UpsertWhatsAppAccountDto,
  WhatsAppAccountResponseDto,
  WhatsAppProvisionResultDto,
  WhatsAppVerifyResultDto,
} from './dto/whatsapp.dto';
import { WhatsAppService } from './whatsapp.service';

/**
 * Elden kurulum: platform yöneticisi kiracının WABA bağlantısını kurar.
 *
 * Klinik ekranındaki (`integrations/whatsapp`) akışın aynısı — kimlik
 * bilgisini yaz, Meta'ya doğrulat, standart şablonları WABA'ya gönder —
 * ama klinik hesabıyla giriş yapmadan. İş, kiracıya daraltılmış bir alt
 * bağlamda `WhatsAppService` ile yapılır; token yine şifreli saklanır ve
 * yanıtta MASKELİ döner.
 *
 * Test gönderimi bilerek YOK: gerçek bir numaraya mesaj atmak kliniğin
 * kararıdır, platform ekranından yapılmaz.
 */
@ApiTags('integrations')
@ApiBearerAuth('bearerAuth')
@Controller('platform/tenants/:id/whatsapp')
@PlatformAdminOnly()
export class PlatformWhatsAppController {
  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly tx: TenantTxService,
    private readonly context: RequestContextService,
  ) {}

  private async forTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const tenant = await this.tx.runAsPlatform((tx) => tenancyRepo.findTenantById(tx, tenantId));
    if (tenant === undefined) throw AppError.notFound('Kiracı bulunamadı');
    return this.context.runAsPlatformForTenant(tenantId, fn);
  }

  @Get()
  @ApiOperation({ summary: 'Kiracının WhatsApp hesabı (token maskeli) ve şablon yansıması' })
  @ApiOkResponse({ type: PlatformWhatsAppDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PlatformWhatsAppDto> {
    return this.forTenant(id, async () => ({
      account: await this.whatsapp.get(),
      templates: await this.whatsapp.listTemplates(),
    }));
  }

  @Put()
  @ApiOperation({
    summary: 'Kiracının WABA kimlik bilgilerini yaz (hesap doğrulanmamış duruma düşer)',
  })
  @ApiOkResponse({ type: WhatsAppAccountResponseDto })
  upsert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpsertWhatsAppAccountDto,
  ): Promise<WhatsAppAccountResponseDto> {
    return this.forTenant(id, () => this.whatsapp.upsert(body));
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kimlik bilgilerini Meta’ya doğrulat ve şablon listesini tazele' })
  @ApiOkResponse({ type: WhatsAppVerifyResultDto })
  verify(@Param('id', ParseUUIDPipe) id: string): Promise<WhatsAppVerifyResultDto> {
    return this.forTenant(id, () => this.whatsapp.verify());
  }

  @Post('templates/provision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Klinara standart şablonlarını kiracının WABA’sına gönder' })
  @ApiOkResponse({ type: WhatsAppProvisionResultDto })
  provision(@Param('id', ParseUUIDPipe) id: string): Promise<WhatsAppProvisionResultDto> {
    return this.forTenant(id, () => this.whatsapp.provisionTemplates());
  }
}
