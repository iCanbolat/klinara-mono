import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { Tx } from '../../database/tenant-tx';
import type { MessageActionKind } from '../../database/schema';
import * as repo from './webhook.repository';
import { sha256 } from './whatsapp-webhook.service';

export interface IssueActionInput {
  appointmentId: string;
  messageLogId?: string | null;
  action: MessageActionKind;
  /** Verilmezse `MESSAGE_ACTION_TTL_HOURS`. */
  ttlHours?: number;
}

/**
 * Buton yanıtı token'ları.
 *
 * Token DÜZ METİN olarak yalnız burada, üretildiği anda görülür; veritabanına
 * `sha256`'sı yazılır (telefon doğrulama kodlarının deseninin aynısı). Bir DB
 * sızıntısı, başkasının randevusunu iptal etme yetkisi vermez.
 */
@Injectable()
export class MessageActionsService {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  async issue(tx: Tx, tenantId: string, input: IssueActionInput): Promise<string> {
    const token = randomBytes(18).toString('base64url');
    const ttl =
      input.ttlHours ?? this.config.get('MESSAGE_ACTION_TTL_HOURS', { infer: true }) ?? 48;

    await repo.createAction(tx, {
      tenantId,
      appointmentId: input.appointmentId,
      messageLogId: input.messageLogId ?? null,
      action: input.action,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttl * 60 * 60 * 1000),
    });

    return token;
  }
}
