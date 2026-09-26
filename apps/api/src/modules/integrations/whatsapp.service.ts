import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import { normalizePhone } from '../../common/phone';
import { PermanentSendError, TransientSendError } from '../notifications/send-errors';
import {
  WHATSAPP_CLIENT,
  type WhatsAppClient,
  type WhatsAppCredentials,
} from '../../lib/whatsapp/whatsapp.types';
import * as repo from './whatsapp.repository';
import { redactToken, WhatsAppSenderService } from './whatsapp-sender.service';
import { STANDARD_TEMPLATES, toDraft } from './whatsapp-standard-templates';
import type {
  UpsertWhatsAppAccountDto,
  WhatsAppAccountResponseDto,
  WhatsAppProvisionItemDto,
  WhatsAppProvisionResultDto,
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
    @Inject(WHATSAPP_CLIENT) private readonly client: WhatsAppClient,
  ) {}

  async get(): Promise<WhatsAppAccountResponseDto | null> {
    const row = await this.tx.run((tx) => repo.findAccount(tx));
    return row === undefined ? null : this.toResponse(row);
  }

  async upsert(input: UpsertWhatsAppAccountDto): Promise<WhatsAppAccountResponseDto> {
    const row = await this.tx.run(async (tx) => {
      // `appSecret` verilmezse KAYITLI değer korunur. Eskiden `null` yazılıyordu: kimlik
      // bilgisini güncelleyen (ör. yalnız token'ı yenileyen) her kayıt webhook imza
      // sırrını sessizce siliyor, gelen mesajlar doğrulanamayıp düşüyor ve gelen kutusu
      // boş kalıyordu. Token okunamadığı için her kayıtta yeniden istenir; secret'ı da
      // yeniden istemek, kullanıcıyı Meta panelinden bir sırrı daha kopyalamaya zorlardı.
      const current = input.appSecret === undefined ? await repo.findAccount(tx) : undefined;
      return repo.upsertAccount(tx, this.tx.tenantId, {
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        businessPhone:
          input.businessPhone === undefined ? null : normalizePhone(input.businessPhone),
        accessTokenEncrypted: this.encryption.encrypt(input.accessToken),
        appSecretEncrypted:
          input.appSecret === undefined
            ? (current?.appSecretEncrypted ?? null)
            : this.encryption.encrypt(input.appSecret),
        apiVersion: input.apiVersion ?? this.config.get('WHATSAPP_API_VERSION', { infer: true }),
      });
    });
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
      bodyText: row.bodyText,
      buttons: row.buttons,
      syncedAt: row.syncedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Klinara'nın standart template setini kiracının WABA'sına yazar.
   *
   * İDEMPOTENT: Meta'da aynı ad + dilde bulunan template'e dokunulmaz (onaylı
   * bir template'i yeniden göndermek onu onaya düşürmezdi ama gereksiz bir
   * istek ve bir "zaten var" hatası olurdu). Bir template'in başarısız olması
   * ötekileri durdurmaz — sonuç satır satır döner.
   *
   * Ağ çağrıları transaction DIŞINDA: Meta'yı beklerken bir DB bağlantısını
   * açık tutmanın sebebi yok. Sonunda yansıma (`whatsapp_templates`) tazelenir.
   */
  async provisionTemplates(): Promise<WhatsAppProvisionResultDto> {
    const account = await this.tx.run((tx) => repo.findAccount(tx));
    if (account === undefined) {
      throw new AppError(
        422,
        ERROR_CODES.WHATSAPP_NOT_CONFIGURED,
        'Önce WhatsApp hesabının kimlik bilgilerini kaydedin',
      );
    }

    const credentials: WhatsAppCredentials = {
      phoneNumberId: account.phoneNumberId,
      accessToken: this.encryption.decrypt(account.accessTokenEncrypted),
      apiVersion: account.apiVersion,
    };

    const existing = await this.callMeta(credentials.accessToken, () =>
      this.client.listTemplates(credentials, account.wabaId),
    );
    const byKey = new Map(existing.map((row) => [`${row.name}:${row.language}`, row]));

    const results: WhatsAppProvisionItemDto[] = [];
    for (const template of STANDARD_TEMPLATES) {
      const found = byKey.get(`${template.name}:${template.language}`);
      if (found !== undefined) {
        results.push({ name: template.name, outcome: 'exists', status: found.status, error: null });
        continue;
      }
      try {
        const created = await this.client.createTemplate(
          credentials,
          account.wabaId,
          toDraft(template),
        );
        results.push({ name: template.name, outcome: 'created', status: created.status, error: null });
      } catch (error) {
        const detail = redactToken(
          error instanceof Error ? error.message : String(error),
          credentials.accessToken,
        );
        // Aynı anda iki sekmeden basılırsa ikincisi "zaten var" alır; bu bir
        // hata değil, istenen sonuç.
        if (/already exists/i.test(detail)) {
          results.push({ name: template.name, outcome: 'exists', status: 'pending', error: null });
          continue;
        }
        results.push({ name: template.name, outcome: 'failed', status: null, error: detail });
      }
    }

    // Yansıma Meta'dan YENİDEN okunur: az önce oluşturulanlar da listede
    // görünsün ve durumları Meta'nın söylediği olsun.
    const refreshed = await this.callMeta(credentials.accessToken, () =>
      this.client.listTemplates(credentials, account.wabaId),
    ).catch(() => undefined);
    if (refreshed !== undefined) {
      await this.tx.run((tx) => repo.replaceTemplates(tx, this.tx.tenantId, refreshed));
    }

    return {
      results,
      created: results.filter((row) => row.outcome === 'created').length,
      failed: results.filter((row) => row.outcome === 'failed').length,
    };
  }

  /** Meta çağrısının hatasını HTTP hatasına çevirir; token metinden silinir. */
  private async callMeta<T>(accessToken: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      const detail = redactToken(error instanceof Error ? error.message : String(error), accessToken);
      if (error instanceof PermanentSendError) throw new AppError(422, error.code, detail);
      if (error instanceof TransientSendError) throw new AppError(503, error.code, detail);
      throw error;
    }
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
