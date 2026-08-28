import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import { normalizePhone } from '../../common/phone';
import { PermanentSendError, TransientSendError } from '../notifications/send-errors';
import * as repo from './whatsapp.repository';
import { WhatsAppSenderService } from './whatsapp-sender.service';
import type {
  UpsertWhatsAppAccountDto,
  WhatsAppAccountResponseDto,
  WhatsAppTemplateResponseDto,
  WhatsAppTestResultDto,
  WhatsAppTestSendDto,
  WhatsAppVerifyResultDto,
} from './dto/whatsapp.dto';

/**
 * WhatsApp entegrasyonu yönetimi.
 *
 * Token YAZILIR ama HİÇ OKUNMAZ: yanıtlarda yalnız maskesi döner ve
 * veritabanında şifrelidir. "Token'ı gösteren" bir uç eklemek, bir XSS ya da
 * yetkisiz bir okuma ile kiracının WhatsApp hesabını devretmek demekti.
 */
@Injectable()
export class WhatsAppService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly encryption: FieldEncryptionService,
    private readonly sender: WhatsAppSenderService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async get(): Promise<WhatsAppAccountResponseDto | null> {
    const row = await this.tx.run((tx) => repo.findAccount(tx));
    return row === undefined ? null : this.toResponse(row);
  }

  async upsert(input: UpsertWhatsAppAccountDto): Promise<WhatsAppAccountResponseDto> {
    const row = await this.tx.run((tx) =>
      repo.upsertAccount(tx, this.tx.tenantId, {
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        businessPhone:
          input.businessPhone === undefined ? null : normalizePhone(input.businessPhone),
        accessTokenEncrypted: this.encryption.encrypt(input.accessToken),
        appSecretEncrypted:
          input.appSecret === undefined ? null : this.encryption.encrypt(input.appSecret),
        apiVersion: input.apiVersion ?? this.config.get('WHATSAPP_API_VERSION', { infer: true }),
      }),
    );
    return this.toResponse(row);
  }

  /**
   * Kimlik bilgilerini GERÇEKTEN doğrular: Meta'dan template listesi çekilir.
   * Başarılıysa hesap `active` olur ve template yansıması tazelenir.
   */
  async verify(): Promise<WhatsAppVerifyResultDto> {
    const result = await this.tx.run(async (tx) => {
      const outcome = await this.sender.verify(tx, this.tx.tenantId);
      const templates = outcome.ok ? await repo.listTemplates(tx) : [];
      return { outcome, count: templates.length };
    });

    return {
      ok: result.outcome.ok,
      error: result.outcome.error ?? null,
      templateCount: result.count,
    };
  }

  async listTemplates(): Promise<WhatsAppTemplateResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listTemplates(tx));
    return rows.map((row) => ({
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      bodyVariableCount: row.bodyVariableCount,
      buttons: row.buttons,
      syncedAt: row.syncedAt?.toISOString() ?? null,
    }));
  }

  /** Test gönderimi: onaylı bir template ile gerçek bir mesaj gider. */
  async testSend(input: WhatsAppTestSendDto): Promise<WhatsAppTestResultDto> {
    const to = normalizePhone(input.to);
    if (to === null) {
      throw new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Telefon numarası geçersiz');
    }

    try {
      const result = await this.sender.send(this.tx.tenantId, {
        to,
        body: '',
        templateName: input.templateName,
        templateLanguage: input.templateLanguage ?? 'tr',
        parameters: [],
      });
      return { accepted: true, providerMessageId: result.messageId };
    } catch (error) {
      // Gönderim hataları burada HTTP hatasına çevrilir: test ucu senkron bir
      // "çalışıyor mu?" sorusudur, kuyruğa iş bırakmaz.
      if (error instanceof PermanentSendError) {
        throw new AppError(422, error.code, error.message);
      }
      if (error instanceof TransientSendError) {
        throw new AppError(503, error.code, error.message);
      }
      throw error;
    }
  }

  private toResponse(row: repo.WhatsAppAccountRow): WhatsAppAccountResponseDto {
    return {
      wabaId: row.wabaId,
      phoneNumberId: row.phoneNumberId,
      businessPhone: row.businessPhone,
      apiVersion: row.apiVersion,
      status: row.status,
      accessTokenMasked: WhatsAppService.mask(this.encryption.decrypt(row.accessTokenEncrypted)),
      hasAppSecret: row.appSecretEncrypted !== null,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      lastError: row.lastError,
    };
  }

  /** Son 4 hane dışında hiçbir şey göstermez. */
  private static mask(token: string): string {
    return `${'•'.repeat(8)}${token.slice(-4)}`;
  }
}
