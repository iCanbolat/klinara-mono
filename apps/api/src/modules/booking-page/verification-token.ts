import { randomBytes } from 'node:crypto';

/**
 * DNS TXT kaydına yazılacak doğrulama değeri.
 *
 * Sır değil (DNS'te herkese açık duracak) ama TAHMİN EDİLEMEZ olmalı: tahmin
 * edilebilseydi, bir saldırgan kendi alan adını kaydedip beklenen değeri
 * önceden yazarak başkasının doğrulamasını taklit edebilirdi.
 */
export function newVerificationToken(): string {
  return `klinara-verify-${randomBytes(16).toString('hex')}`;
}
