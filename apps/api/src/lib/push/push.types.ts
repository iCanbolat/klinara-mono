export type PushPlatform = 'ios' | 'android';
export type PushEnvironment = 'sandbox' | 'production';

export interface PushDevice {
  platform: PushPlatform;
  environment: PushEnvironment;
  token: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /**
   * Dokununca açılacak yer için kimlikler. YALNIZ kimlik: müşteri adı, hizmet
   * ya da mesaj metni buraya girmez — yük cihazda bildirim merkezinde saklanır.
   */
  data: Record<string, string>;
  /** Aynı anahtarlı bildirimler cihazda üst üste biner (ör. aynı sohbet). */
  collapseKey?: string;
}

export type PushOutcome =
  | { status: 'sent' }
  /** Anahtar artık geçerli değil (uygulama silindi, izin geri alındı): satır silinmeli. */
  | { status: 'invalid_token' }
  | { status: 'failed'; reason: string };

/**
 * Push gönderim arayüzü — SMS ve e-posta göndericileriyle aynı adapter kalıbı.
 *
 * Sağlayıcıya DOĞRUDAN gidiyoruz: iOS için APNs, Android için FCM HTTP v1.
 * Arada bir aracı servis yok ve iOS uygulaması Firebase SDK'sı taşımıyor.
 */
export interface PushSender {
  /** Bu platform için kimlik bilgisi tanımlı mı. */
  supports(platform: PushPlatform): boolean;
  send(device: PushDevice, message: PushMessage): Promise<PushOutcome>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/**
 * Ortam değişkenindeki anahtar: düz PEM (`\n` kaçışlı olabilir) ya da base64.
 * `.env` dosyalarında çok satırlı değer taşımak kırılgan olduğu için ikisi de
 * kabul ediliyor.
 */
export function decodeSecret(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('-----BEGIN') || trimmed.startsWith('{')) {
    return trimmed.replace(/\\n/g, '\n');
  }
  return Buffer.from(trimmed, 'base64').toString('utf8');
}

export function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}
