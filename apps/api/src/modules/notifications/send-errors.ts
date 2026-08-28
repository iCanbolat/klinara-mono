import { ERROR_CODES, type ErrorCode } from '@klinara/shared';

/**
 * Gönderim hatalarının İKİ sınıfı vardır ve ayrım worker'ın davranışını
 * belirler:
 *
 *   - KALICI (geçersiz numara, onaysız template, yapılandırılmamış kanal):
 *     yeniden denemek aynı sonucu verir. Mesaj `failed` yazılır ve iş biter;
 *     kuyruğu meşgul etmek, gerçek geçici hataların sırasını uzatmaktan başka
 *     bir işe yaramaz.
 *   - GEÇİCİ (429, 5xx, ağ): yeniden denenir. İş kuyruğa geri fırlatılır ve
 *     pg-boss üstel geri çekilmeyle tekrar dener.
 */
export class PermanentSendError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentSendError';
  }
}

export class TransientSendError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode = ERROR_CODES.SERVICE_UNAVAILABLE,
  ) {
    super(message);
    this.name = 'TransientSendError';
  }
}
