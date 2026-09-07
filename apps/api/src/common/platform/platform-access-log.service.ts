import { Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import type pg from 'pg';
import { PG_POOL } from '../../database/database.constants';
import { AppError } from '../errors/app-error';

export interface PlatformAccessEntry {
  requestId: string | null;
  method: string;
  path: string;
  reason: string;
  clientIp: string | null;
  userAgent: string | null;
  tokenExpiresAt: string | null;
}

/**
 * Platform (destek) erişiminin kaydı.
 *
 * ⚠️ KAYIT YAZILAMAZSA ERİŞİM DE YOK. Hata yutulup istek geçirilseydi, kaydın
 * varlığı bir garanti değil bir temenni olurdu — "kimin baktığını
 * bilemediğimiz" tam olarak kaydı tutmamızın sebebi. Bu, uygulamanın geri
 * kalanındaki "loglama isteği düşürmez" kuralının bilinçli tek istisnasıdır:
 * burada log, çıktı değil KAPININ KENDİSİDİR.
 */
@Injectable()
export class PlatformAccessLogService {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async record(entry: PlatformAccessEntry): Promise<void> {
    try {
      await this.pool.query(
        `insert into platform_access_log
           (request_id, method, path, reason, client_ip, user_agent, token_expires_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.requestId,
          entry.method,
          entry.path,
          entry.reason,
          entry.clientIp,
          entry.userAgent,
          entry.tokenExpiresAt,
        ],
      );
    } catch (error) {
      throw new AppError(
        503,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        'Destek erişimi kaydedilemedi',
        {
          detail: 'Erişim kaydı yazılamadığı için işlem reddedildi.',
          cause: error,
        },
      );
    }
  }
}
