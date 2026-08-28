import { Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { WHATSAPP_CLIENT, type WhatsAppClient } from '../../lib/whatsapp/whatsapp.types';
import { PermanentSendError } from '../notifications/send-errors';
import * as repo from './whatsapp.repository';

/** Pencere 24 saattir; Meta'nın kuralı. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WhatsAppOutbound {
  to: string;
  /** Serbest metin — yalnız pencere AÇIKKEN gönderilebilir. */
  body: string;
  templateName?: string | undefined;
  templateLanguage?: string | undefined;
  /** Meta'nın konumsal parametreleri, sırayla. */
  parameters?: string[] | undefined;
  buttonPayloads?: string[] | undefined;
}

/**
 * Kiracının WhatsApp hesabıyla gönderim.
 *
 * Kimlik bilgileri VERİTABANINDA şifreli durur ve yalnız burada, gönderim
 * anında çözülür. Token bir daha hiçbir yere (log, yanıt, hata mesajı)
 * aktarılmaz.
 */
@Injectable()
export class WhatsAppSenderService {
  constructor(
    @Inject(WHATSAPP_CLIENT) private readonly client: WhatsAppClient,
    private readonly encryption: FieldEncryptionService,
    private readonly tx: TenantTxService,
  ) {}

  async send(tenantId: string, message: WhatsAppOutbound): Promise<{ messageId: string | null }> {
    const context = await this.tx.runForTenant(tenantId, async (tx) => {
      const account = await repo.findAccount(tx);
      if (account === undefined) return undefined;
      return { account, lastInbound: await repo.lastInboundAt(tx, message.to) };
    });

    if (context === undefined) {
      throw new PermanentSendError(
        ERROR_CODES.WHATSAPP_NOT_CONFIGURED,
        'Kiracının WhatsApp hesabı yapılandırılmamış',
      );
    }

    const credentials = {
      phoneNumberId: context.account.phoneNumberId,
      accessToken: this.encryption.decrypt(context.account.accessTokenEncrypted),
      apiVersion: context.account.apiVersion,
    };

    if (message.templateName !== undefined) {
      return this.client.sendTemplate(credentials, {
        to: message.to,
        templateName: message.templateName,
        languageCode: message.templateLanguage ?? 'tr',
        parameters: message.parameters ?? [],
        ...(message.buttonPayloads !== undefined
          ? { buttonPayloads: message.buttonPayloads }
          : {}),
      });
    }

    // 24 saatlik müşteri hizmetleri penceresi KODDA MODELLENİR (mimari karar
    // 4.6): kapalıyken serbest metin göndermek Meta tarafından reddedilirdi ve
    // sebebi kayıtta görünmezdi. Burada kendi kodumuzla, gönderim yapılmadan
    // reddediliyor.
    const open =
      context.lastInbound !== undefined && Date.now() - context.lastInbound.getTime() < WINDOW_MS;
    if (!open) {
      throw new PermanentSendError(
        ERROR_CODES.WHATSAPP_WINDOW_CLOSED,
        '24 saatlik müşteri hizmetleri penceresi kapalı — yalnız onaylı template gönderilebilir',
      );
    }

    return this.client.sendText(credentials, { to: message.to, body: message.body });
  }

  /** Yapılandırma doğrulaması: template listesi çekilebiliyorsa kimlik bilgileri geçerlidir. */
  async verify(tx: Tx, tenantId: string): Promise<{ ok: boolean; error?: string }> {
    const account = await repo.findAccount(tx);
    if (account === undefined) return { ok: false, error: 'Hesap yapılandırılmamış' };

    try {
      const templates = await this.client.listTemplates(
        {
          phoneNumberId: account.phoneNumberId,
          accessToken: this.encryption.decrypt(account.accessTokenEncrypted),
          apiVersion: account.apiVersion,
        },
        account.wabaId,
      );
      await repo.replaceTemplates(tx, tenantId, templates);
      await repo.markVerified(tx, tenantId, { ok: true });
      return { ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await repo.markVerified(tx, tenantId, { ok: false, error: detail });
      return { ok: false, error: detail };
    }
  }
}
