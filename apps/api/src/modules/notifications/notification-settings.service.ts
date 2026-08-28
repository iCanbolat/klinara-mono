import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { NotificationChannel } from '../../database/schema';
import { BranchAccessService } from '../tenancy/branch-access.service';
import type { Principal } from '../identity/principal';
import { ALL_EVENTS, EVENT_DEFINITIONS } from './default-templates';
import * as repo from './notifications.repository';
import { templateVariables } from './template-renderer';
import type {
  NotificationPreferenceResponseDto,
  NotificationTemplateResponseDto,
  UpsertNotificationPreferenceDto,
  UpsertNotificationTemplateDto,
} from './dto/notification.dto';

/**
 * Şablon ve tercih yönetimi.
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
    private readonly branchAccess: BranchAccessService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async listTemplates(): Promise<NotificationTemplateResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listTemplates(tx));
    const byKey = new Map(rows.map((row) => [`${row.event}:${row.channel}:${row.locale}`, row]));

    const result: NotificationTemplateResponseDto[] = [];
    for (const event of ALL_EVENTS) {
      const definition = EVENT_DEFINITIONS[event];
      for (const channel of Object.keys(definition.templates) as NotificationChannel[]) {
        const override = byKey.get(`${event}:${channel}:tr`);
        const fallback = definition.templates[channel];
        result.push({
          id: override?.id ?? null,
          event,
          channel,
          locale: 'tr',
          kind: definition.kind,
          subject: override?.subject ?? fallback?.subject ?? null,
          body: override?.body ?? fallback?.body ?? '',
          whatsappTemplateName: override?.whatsappTemplateName ?? null,
          whatsappTemplateLanguage: override?.whatsappTemplateLanguage ?? null,
          whatsappVariables: override?.whatsappVariables ?? [],
          isActive: override?.isActive ?? true,
          isDefault: override === undefined,
          variables: templateVariables(override?.body ?? fallback?.body ?? ''),
        });
      }
    }

    // Kiracının varsayılanı olmayan bir kanal için yazdığı şablon (ör. WhatsApp)
    // listede kaybolmamalı.
    for (const row of rows) {
      const known = result.some(
        (item) => item.event === row.event && item.channel === row.channel && item.id !== null,
      );
      if (known) continue;
      result.push({
        id: row.id,
        event: row.event,
        channel: row.channel,
        locale: row.locale,
        kind: EVENT_DEFINITIONS[row.event].kind,
        subject: row.subject,
        body: row.body,
        whatsappTemplateName: row.whatsappTemplateName,
        whatsappTemplateLanguage: row.whatsappTemplateLanguage,
        whatsappVariables: row.whatsappVariables,
        isActive: row.isActive,
        isDefault: false,
        variables: templateVariables(row.body),
      });
    }

    return result;
  }

  async upsertTemplate(
    input: UpsertNotificationTemplateDto,
  ): Promise<NotificationTemplateResponseDto> {
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
      kind: EVENT_DEFINITIONS[row.event].kind,
      subject: row.subject,
      body: row.body,
      whatsappTemplateName: row.whatsappTemplateName,
      whatsappTemplateLanguage: row.whatsappTemplateLanguage,
      whatsappVariables: row.whatsappVariables,
      isActive: row.isActive,
      isDefault: false,
      variables: templateVariables(row.body),
    };
  }

  async listPreferences(): Promise<NotificationPreferenceResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listPreferences(tx));
    const stored = rows.map((row) => this.toPreferenceResponse(row));

    const covered = new Set(rows.filter((row) => row.branchId === null).map((row) => row.event));
    const defaults = ALL_EVENTS.filter((event) => !covered.has(event)).map((event) => ({
      id: null,
      branchId: null,
      event,
      kind: EVENT_DEFINITIONS[event].kind,
      channels: EVENT_DEFINITIONS[event].channels,
      quietHoursStart: this.defaultQuietHours().start,
      quietHoursEnd: this.defaultQuietHours().end,
      isDefault: true,
    }));

    return [...defaults, ...stored].sort((a, b) => a.event.localeCompare(b.event));
  }

  async upsertPreference(
    principal: Principal,
    input: UpsertNotificationPreferenceDto,
  ): Promise<NotificationPreferenceResponseDto> {
    if (input.branchId !== undefined) {
      await this.branchAccess.assertInput(principal, input.branchId);
    }
    if ((input.quietHoursStart === undefined) !== (input.quietHoursEnd === undefined)) {
      throw new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Sessiz saat başlangıcı ve bitişi birlikte verilmeli',
      );
    }

    const row = await this.tx.run((tx) =>
      repo.upsertPreference(tx, this.tx.tenantId, {
        branchId: input.branchId ?? null,
        event: input.event,
        channels: input.channels,
        quietHoursStart: input.quietHoursStart ?? null,
        quietHoursEnd: input.quietHoursEnd ?? null,
      }),
    );
    return this.toPreferenceResponse(row);
  }

  private toPreferenceResponse(
    row: repo.NotificationPreferenceRow,
  ): NotificationPreferenceResponseDto {
    return {
      id: row.id,
      branchId: row.branchId,
      event: row.event,
      kind: EVENT_DEFINITIONS[row.event].kind,
      channels: row.channels,
      quietHoursStart: row.quietHoursStart?.slice(0, 5) ?? this.defaultQuietHours().start,
      quietHoursEnd: row.quietHoursEnd?.slice(0, 5) ?? this.defaultQuietHours().end,
      isDefault: false,
    };
  }

  private defaultQuietHours(): { start: string; end: string } {
    return {
      start: this.config.get('NOTIFICATION_QUIET_HOURS_START', { infer: true }),
      end: this.config.get('NOTIFICATION_QUIET_HOURS_END', { infer: true }),
    };
  }
}
