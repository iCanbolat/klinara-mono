import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import * as repo from './idempotency.repository';

const TTL_HOURS = 24;

export interface IdempotentResult<T> {
  status: number;
  body: T;
}

/**
 * `Idempotency-Key` desteği (API sözleşmesi 5.6).
 *
 * Akış:
 *   1. Anahtar kilitli olarak yazılmaya çalışılır (atomik `on conflict`).
 *   2. Yazılabildiyse iş koşar; yanıt kaydedilir.
 *   3. Yazılamadıysa kayıt okunur:
 *      - aynı gövde + kayıtlı yanıt → yanıt AYNEN tekrarlanır,
 *      - aynı gövde + hâlâ kilitli  → istek uçuşta, 409,
 *      - farklı gövde               → 409 IDEMPOTENCY_CONFLICT.
 *
 * Kilit ve iş AYRI transaction'lardadır. Aynı transaction'da olsalardı, iş
 * rollback olduğunda kilit de geri alınır ve tekrar koruması hiç yazılmamış
 * gibi olurdu; ayrıldığında ise başarısız istekte kilidi açıkça bırakıyoruz.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly tx: TenantTxService) {}

  async run<T>(
    key: string | undefined,
    requestPayload: unknown,
    work: () => Promise<IdempotentResult<T>>,
  ): Promise<IdempotentResult<T>> {
    if (key === undefined || key.trim().length === 0) return work();

    const trimmed = key.trim();
    if (trimmed.length > 255) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Idempotency-Key çok uzun');
    }

    const hash = IdempotencyService.hash(requestPayload);
    const tenantId = this.tx.tenantId;

    const claimed = await this.tx.run((tx) =>
      repo.tryClaim(tx, tenantId, trimmed, hash, TTL_HOURS),
    );

    if (!claimed) {
      const existing = await this.tx.run((tx) => repo.findRecord(tx, tenantId, trimmed));
      if (existing === undefined) {
        // Kayıt aradaki bir temizlikte silinmiş; yeniden denemek güvenli.
        return work();
      }
      if (existing.requestHash !== hash) {
        throw AppError.conflict(
          ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'Aynı Idempotency-Key farklı bir istekle kullanıldı',
        );
      }
      if (existing.responseStatus === null) {
        throw AppError.conflict(
          ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'Aynı anahtarla bir istek hâlâ işleniyor',
          { detail: 'Kısa bir süre sonra tekrar deneyin.' },
        );
      }
      return { status: existing.responseStatus, body: existing.responseBody as T };
    }

    try {
      const result = await work();
      await this.tx.run((tx) =>
        repo.storeResponse(tx, tenantId, trimmed, result.status, result.body),
      );
      return result;
    } catch (error) {
      // Kilidi bırak: kalıcı bir hata bile olsa istemcinin AYNI anahtarla
      // düzeltilmiş bir istek göndermesi engellenmemeli.
      await this.tx.run((tx) => repo.release(tx, tenantId, trimmed)).catch(() => undefined);
      throw error;
    }
  }

  private static hash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
  }
}
