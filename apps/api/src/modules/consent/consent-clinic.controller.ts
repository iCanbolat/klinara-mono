import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { ConsentSignaturesService, type SignatureRequestMeta } from './consent-signatures.service';
import { ConsentTemplatesService } from './consent-templates.service';
import {
  AppointmentConsentStatusDto,
  AppointmentConsentStatusQueryDto,
  ConsentPdfUrlDto,
  ConsentRequirementsDto,
  ConsentSignatureDto,
  ConsentSignatureSummaryDto,
  ConsentTemplateDto,
  ConsentTemplateVersionSummaryDto,
  CreateConsentSignatureDto,
  CreateConsentTemplateDto,
  ServiceConsentTemplatesDto,
  SetServiceConsentTemplatesDto,
  UpdateConsentTemplateDraftDto,
  UpdateConsentTemplateDto,
} from './dto/consent-clinic.dto';

function requestMeta(request: Request): SignatureRequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : undefined,
  };
}

/** İşlem onamı şablonları — metinler `consent:manage`, okuma `consent:read`. */
@ApiTags('consent')
@ApiBearerAuth('bearerAuth')
@Controller('consent-templates')
export class ConsentTemplatesController {
  constructor(private readonly templates: ConsentTemplatesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({ summary: 'İşlem onamı şablonları' })
  @ApiOkResponse({ type: [ConsentTemplateDto] })
  list(): Promise<ConsentTemplateDto[]> {
    return this.templates.list();
  }

  @Post()
  @RequirePermission(PERMISSIONS.CONSENT_MANAGE)
  @ApiOperation({
    summary: 'Şablon oluştur',
    description: '`body` verilirse ilk taslak olarak kaydedilir.',
  })
  @ApiCreatedResponse({ type: ConsentTemplateDto })
  create(@Body() body: CreateConsentTemplateDto): Promise<ConsentTemplateDto> {
    return this.templates.create(body);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOkResponse({ type: ConsentTemplateDto })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<ConsentTemplateDto> {
    return this.templates.get(id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CONSENT_MANAGE)
  @ApiOperation({ summary: 'Şablon adı / geçerlilik süresi' })
  @ApiOkResponse({ type: ConsentTemplateDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateConsentTemplateDto,
  ): Promise<ConsentTemplateDto> {
    return this.templates.update(id, body);
  }

  @Put(':id/draft')
  @RequirePermission(PERMISSIONS.CONSENT_MANAGE)
  @ApiOperation({
    summary: 'Taslağı kaydet',
    description: 'Şablon başına tek taslak; `sha256` SUNUCUDA hesaplanır.',
  })
  @ApiOkResponse({ type: ConsentTemplateDto })
  saveDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateConsentTemplateDraftDto,
  ): Promise<ConsentTemplateDto> {
    return this.templates.saveDraft(id, body.body);
  }

  @Post(':id/publish')
  @RequirePermission(PERMISSIONS.CONSENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Taslağı yayınla',
    description: 'GERİ ALINAMAZ: yayınlanan gövde değişmez; önceki sürüm arşive alınır.',
  })
  @ApiOkResponse({ type: ConsentTemplateDto })
  publish(@Param('id', new ParseUUIDPipe()) id: string): Promise<ConsentTemplateDto> {
    return this.templates.publish(id);
  }

  @Post(':id/archive')
  @RequirePermission(PERMISSIONS.CONSENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Şablonu arşivle',
    description: 'Artık hiçbir randevuda istenmez; imzalar korunur.',
  })
  @ApiOkResponse({ type: ConsentTemplateDto })
  archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<ConsentTemplateDto> {
    return this.templates.archive(id);
  }

  @Post(':id/restore')
  @RequirePermission(PERMISSIONS.CONSENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Şablonu arşivden çıkar' })
  @ApiOkResponse({ type: ConsentTemplateDto })
  restore(@Param('id', new ParseUUIDPipe()) id: string): Promise<ConsentTemplateDto> {
    return this.templates.restore(id);
  }

  @Get(':id/versions')
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({ summary: 'Sürüm geçmişi', description: 'Gövde dönmez.' })
  @ApiOkResponse({ type: [ConsentTemplateVersionSummaryDto] })
  versions(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConsentTemplateVersionSummaryDto[]> {
    return this.templates.listVersions(id);
  }
}

/** Hizmet → gerekli işlem onamları. Hizmet ayarı olduğu için `service:*` izinleri. */
@ApiTags('consent')
@ApiBearerAuth('bearerAuth')
@Controller('services')
export class ServiceConsentTemplatesController {
  constructor(private readonly templates: ConsentTemplatesService) {}

  @Get(':id/consent-templates')
  @RequirePermission(PERMISSIONS.SERVICE_READ)
  @ApiOkResponse({ type: ServiceConsentTemplatesDto })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<ServiceConsentTemplatesDto> {
    return this.templates.serviceTemplates(id);
  }

  @Put(':id/consent-templates')
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @ApiOperation({
    summary: 'Hizmetin gerektirdiği onamlar',
    description: 'Liste TAMAMEN değiştirilir.',
  })
  @ApiOkResponse({ type: ServiceConsentTemplatesDto })
  set(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetServiceConsentTemplatesDto,
  ): Promise<ServiceConsentTemplatesDto> {
    return this.templates.setServiceTemplates(id, body.templateIds);
  }
}

/**
 * Klinikte imzalı onam: gereksinim, imza alma, kanıt.
 *
 * İmza almak `consent:collect` (uygulayıcı dahil); metinleri değiştirmek
 * `consent:manage`. Okuma `consent:read`.
 */
@ApiTags('consent')
@ApiBearerAuth('bearerAuth')
@Controller()
export class ConsentSignaturesController {
  constructor(private readonly signatures: ConsentSignaturesService) {}

  @Get('appointments/:id/consent-requirements')
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({
    summary: 'Randevunun onam gereksinimi',
    description:
      'Önce KVKK, sonra hizmet sırasıyla işlem onamları. Eksik olanlarda imzalanacak metin döner.',
  })
  @ApiOkResponse({ type: ConsentRequirementsDto })
  appointmentRequirements(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConsentRequirementsDto> {
    return this.signatures.requirementsForAppointment(principal, id);
  }

  @Post('appointments/:id/consent-signatures')
  @RequirePermission(PERMISSIONS.CONSENT_COLLECT)
  @ApiOperation({
    summary: 'Randevu için imzalı onam',
    description:
      'Metin yayındaki sürümle eşleşmezse `CONSENT_TEXT_CHANGED` (409). Kayıt ve PDF değiştirilemez.',
  })
  @ApiCreatedResponse({ type: ConsentSignatureSummaryDto })
  signForAppointment(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateConsentSignatureDto,
    @Req() request: Request,
  ): Promise<ConsentSignatureSummaryDto> {
    return this.signatures.signForAppointment(principal, id, body, requestMeta(request));
  }

  @Get('consent-statuses')
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({
    summary: 'Randevular için onam rozeti',
    description: 'Takvim görünümü için toplu.',
  })
  @ApiOkResponse({ type: [AppointmentConsentStatusDto] })
  statuses(
    @CurrentUser() principal: Principal,
    @Query() query: AppointmentConsentStatusQueryDto,
  ): Promise<AppointmentConsentStatusDto[]> {
    return this.signatures.statuses(principal, query.ids.split(','));
  }

  @Get('customers/:id/consent-requirements')
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({
    summary: 'Müşterinin KVKK onam durumu',
    description: 'Randevusuz bağlam: yalnız KVKK.',
  })
  @ApiOkResponse({ type: ConsentRequirementsDto })
  customerRequirements(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConsentRequirementsDto> {
    return this.signatures.requirementsForCustomer(id);
  }

  @Post('customers/:id/consent-signatures')
  @RequirePermission(PERMISSIONS.CONSENT_COLLECT)
  @ApiOperation({ summary: 'Randevusuz KVKK imzası' })
  @ApiCreatedResponse({ type: ConsentSignatureSummaryDto })
  signForCustomer(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateConsentSignatureDto,
    @Req() request: Request,
  ): Promise<ConsentSignatureSummaryDto> {
    return this.signatures.signForCustomer(principal, id, body, requestMeta(request));
  }

  @Get('customers/:id/consent-signatures')
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({ summary: 'Müşterinin klinik içi imzalı onamları' })
  @ApiOkResponse({ type: [ConsentSignatureSummaryDto] })
  listForCustomer(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConsentSignatureSummaryDto[]> {
    return this.signatures.listForCustomer(id);
  }

  @Get('consent-signatures/:id')
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({
    summary: 'İmzalı onam kanıtı',
    description: 'Gösterilen metnin birebir kopyasıyla.',
  })
  @ApiOkResponse({ type: ConsentSignatureDto })
  get(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConsentSignatureDto> {
    return this.signatures.get(principal, id);
  }

  @Get('consent-signatures/:id/pdf-url')
  @RequirePermission(PERMISSIONS.CONSENT_READ)
  @ApiOperation({
    summary: 'İmzalı onam PDF’i',
    description: 'HER çağrı `customer_record_access_log`a düşer (KVKK m.6).',
  })
  @ApiOkResponse({ type: ConsentPdfUrlDto })
  pdfUrl(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: Request,
  ): Promise<ConsentPdfUrlDto> {
    return this.signatures.pdfUrl(principal, id, requestMeta(request));
  }
}
