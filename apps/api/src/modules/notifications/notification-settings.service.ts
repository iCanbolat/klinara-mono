import { Injectable } from '@nestjs/common';
import { ERROR_CODES, templateSegments } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { NotificationChannel } from '../../database/schema';
import {
  CONFIGURABLE_EVENTS,
  CUSTOMER_CHANNELS,
  EVENT_DEFINITIONS,
  isCustomerEvent,
} from './default-templates';
import * as repo from './notifications.repository';
import { STANDARD_TEMPLATE_BY_EVENT } from '../integrations/whatsapp-standard-templates';
import { templateVariables } from './template-renderer';
import type {
  NotificationTemplateResponseDto,
  UpsertNotificationTemplateDto,
} from './dto/notification.dto';

/**
 * Şablon yönetimi.
 *
 * Liste uçları KİRACI SATIRLARIYLA VARSAYILANLARI BİRLİKTE döndürür
 * (`isDefault` bayrağıyla). Yalnız kiracı satırlarını döndürmek, arayüzde
 * "hiç şablon yok" gibi görünmesine ve kullanıcının aslında yürürlükte olan
 * metni hiç görememesine yol açardı.
 */
@Injectable()
export class NotificationSettingsService {
  constructor(
    private readonly tx: TenantTxService,
  ) {}

  async listTemplates(): Promise<NotificationTemplateResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listTemplates(tx));
    const byKey = new Map(rows.map((row) => [`${row.event}:${row.channel}:${row.locale}`, row]));

    const result: NotificationTemplateResponseDto[] = [];
    for (const event of CONFIGURABLE_EVENTS) {
      const definition = EVENT_DEFINITIONS[event];
      // Standart WhatsApp template'i olan olayda WhatsApp satırı da listelenir:
      // eşleme kodda varsayılan olarak duruyor ve kiracı onu burada görmeli.
      const standard = STANDARD_TEMPLATE_BY_EVENT.get(event);
      const channels = new Set(Object.keys(definition.templates) as NotificationChannel[]);
      if (standard !== undefined) channels.add('whatsapp');

      for (const channel of channels) {
        const override = byKey.get(`${event}:${channel}:tr`);
        const standardFor = channel === 'whatsapp' ? standard : undefined;
        const fallback =
          definition.templates[channel] ??
          (standardFor?.body === undefined ? undefined : { body: standardFor.body });
        const overridesMapping = override?.whatsappTemplateName != null;
        result.push({
          id: override?.id ?? null,
          event,
          channel,
          locale: 'tr',
          subject: override?.subject ?? fallback?.subject ?? null,
          body: override?.body ?? fallback?.body ?? '',
          whatsappTemplateName: overridesMapping
            ? (override?.whatsappTemplateName ?? null)
            : (standardFor?.name ?? null),
          whatsappTemplateLanguage: overridesMapping
            ? (override?.whatsappTemplateLanguage ?? null)
            : (standardFor?.language ?? null),
          whatsappVariables: overridesMapping
            ? (override?.whatsappVariables ?? [])
            : (standardFor?.variables ?? []),
          isActive: override?.isActive ?? true,
          isDefault: override === undefined,
          variables: templateVariables(override?.body ?? fallback?.body ?? ''),
          segments: templateSegments(override?.body ?? fallback?.body ?? ''),
        });
      }
    }

    // Kiracının varsayılanı olmayan bir kanal için yazdığı şablon (ör. WhatsApp)
    // listede kaybolmamalı.
    for (const row of rows) {
      // Geçmişte yazılmış e-posta ve SMS şablonları geri gelmesin: kanallar
      // artık müşteriye kapalı ve düzenlenemeyen bir satır göstermek,
      // kullanıcıya yürürlükte olmayan bir metni yürürlükteymiş gibi okutmak
      // olurdu. (DB enum'u `sms`'i geçmiş için taşıyor, tip taşımıyor.)
      if (isCustomerEvent(row.event) && !CUSTOMER_CHANNELS.includes(row.channel)) continue;
      // Personel olayı şablon ekranında yok; eski bir kiracı satırı da geri gelmesin.
      if (!CONFIGURABLE_EVENTS.includes(row.event)) continue;
      const known = result.some(
        (item) => item.event === row.event && item.channel === row.channel && item.id !== null,
      );
      if (known) continue;
      result.push({
        id: row.id,
        event: row.event,
        channel: row.channel,
        locale: row.locale,
        subject: row.subject,
        body: row.body,
        whatsappTemplateName: row.whatsappTemplateName,
        whatsappTemplateLanguage: row.whatsappTemplateLanguage,
        whatsappVariables: row.whatsappVariables,
        isActive: row.isActive,
        isDefault: false,
        variables: templateVariables(row.body),
        segments: templateSegments(row.body),
      });
    }

    return result;
  }

  async upsertTemplate(
    input: UpsertNotificationTemplateDto,
  ): Promise<NotificationTemplateResponseDto> {
    // Personel iç bildirimi ve elle yazılan cevaplar şablon değildir.
    if (!CONFIGURABLE_EVENTS.includes(input.event)) {
      throw new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Bu olayın şablonu kiracı tarafından düzenlenemez',
      );
    }

    // Müşteriye e-posta gitmiyor: kanal hiçbir müşteri olayında geçerli değil. Kapıyı burada tutmak, DTO'daki `ALL_CHANNELS`
    // kümesini wire düzeyinde bırakıp kuralı olayla birlikte ifade ediyor.
    if (input.channel === 'email' && isCustomerEvent(input.event)) {
      throw new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'E-posta kanalı müşteri bildirimlerinde kullanılmıyor',
      );
    }

    if (input.channel !== 'email' && input.subject !== undefined) {
      throw new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Konu alanı yalnız e-posta kanalında kullanılır',
      );
    }

    // Şablon değişkenleri OLAYIN sözleşmesiyle sınırlıdır: çağıran modül
    // yalnız tanımlı değişkenleri üretir, bilinmeyen bir yer tutucu gönderim
    // anında hata verirdi. Hatayı ŞABLONU YAZAN kişiye, yazdığı anda döndürmek
    // aynı hatayı müşteriye giden mesajda görmekten iyidir.
    const allowed = new Set(EVENT_DEFINITIONS[input.event].variables);
    const used = [
      ...templateVariables(input.body),
      ...templateVariables(input.subject ?? ''),
      // Konumsal eşleme de aynı sözleşmeye tabidir: burada tanımsız bir ad,
      // gönderim anında Meta'ya BOŞ parametre gitmesi demekti.
      ...(input.whatsappVariables ?? []),
    ];
    const unknown = used.filter((name) => !allowed.has(name));
    if (unknown.length > 0) {
      throw new AppError(
        422,
        ERROR_CODES.TEMPLATE_INVALID,
        `Bu olayda tanımlı olmayan değişken: ${unknown.join(', ')}`,
        { detail: `Kullanılabilir değişkenler: ${[...allowed].join(', ')}` },
      );
    }

    const row = await this.tx.run((tx) =>
      repo.upsertTemplate(tx, this.tx.tenantId, {
        event: input.event,
        channel: input.channel,
        locale: input.locale ?? 'tr',
        subject: input.subject ?? null,
        body: input.body,
        whatsappTemplateName: input.whatsappTemplateName ?? null,
        whatsappTemplateLanguage: input.whatsappTemplateLanguage ?? null,
        whatsappVariables: input.whatsappVariables ?? [],
        isActive: input.isActive ?? true,
      }),
    );

    return {
      id: row.id,
      event: row.event,
      channel: row.channel,
      locale: row.locale,
      subject: row.subject,
      body: row.body,
      whatsappTemplateName: row.whatsappTemplateName,
      whatsappTemplateLanguage: row.whatsappTemplateLanguage,
      whatsappVariables: row.whatsappVariables,
      isActive: row.isActive,
      isDefault: false,
      variables: templateVariables(row.body),
      segments: templateSegments(row.body),
    };
  }
}
