import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { ConsentService } from './consent.service';
import {
  ConsentAcceptanceDto,
  ConsentAcceptanceQueryDto,
  ConsentDocumentStateDto,
  ConsentDocumentSummaryDto,
  UpdateConsentDraftDto,
} from './dto/consent.dto';

@ApiTags('consent')
@ApiBearerAuth('bearerAuth')
@Controller('consent-document')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({
    summary: 'Onam metni (yayındaki + taslak)',
    description: 'Yayında metin yoksa `active` `null` döner ve randevu sayfası YAYINLANAMAZ.',
  })
  @ApiOkResponse({ type: ConsentDocumentStateDto })
  get(): Promise<ConsentDocumentStateDto> {
    return this.consent.getState();
  }

  @Put('draft')
  @RequirePermission(PERMISSIONS.CONSENT_MANAGE)
  @ApiOperation({
    summary: 'Taslak onam metnini kaydet',
    description:
      'Site başına tek taslak vardır; ikinci kayıt aynı taslağı günceller. `sha256` SUNUCUDA hesaplanır.',
  })
  @ApiOkResponse({ type: ConsentDocumentStateDto })
  saveDraft(@Body() body: UpdateConsentDraftDto): Promise<ConsentDocumentStateDto> {
    return this.consent.saveDraft(body);
  }

  @Post('publish')
  @RequirePermission(PERMISSIONS.CONSENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Taslağı yayınla',
    description:
      'GERİ ALINAMAZ: yayınlanan gövde bir daha değişmez. Önceki sürüm arşive alınır, silinmez — eski kabul kanıtları ona bağlıdır.',
  })
  @ApiOkResponse({ type: ConsentDocumentStateDto })
  publish(): Promise<ConsentDocumentStateDto> {
    return this.consent.publish();
  }

  @Get('versions')
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({ summary: 'Onam metni sürüm geçmişi', description: 'Gövde dönmez.' })
  @ApiOkResponse({ type: [ConsentDocumentSummaryDto] })
  versions(): Promise<ConsentDocumentSummaryDto[]> {
    return this.consent.listVersions();
  }
}

@ApiTags('consent')
@ApiBearerAuth('bearerAuth')
@Controller('consent-acceptances')
export class ConsentAcceptancesController {
  constructor(private readonly consent: ConsentService) {}

  /**
   * Kabul kanıtı.
   *
   * Filtre ZORUNLU: kiracının tüm onam kabullerini tek çağrıda dökmek, bir
   * ekranın ihtiyaç duymadığı bir toplu PII ihracı olurdu.
   */
  @Get()
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({
    summary: 'Onam kabul kanıtı',
    description:
      '`customerId` veya `appointmentId` ZORUNLU. Müşteriye gösterilen metnin birebir kopyasını, sürümünü, zamanını, IP ve user-agent bilgisini döner.',
  })
  @ApiOkResponse({ type: [ConsentAcceptanceDto] })
  list(@Query() query: ConsentAcceptanceQueryDto): Promise<ConsentAcceptanceDto[]> {
    return this.consent.listAcceptances(query);
  }
}
