import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { base64Url, type PushDevice, type PushMessage, type PushOutcome } from './push.types';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const REQUEST_TIMEOUT_MS = 10_000;
/** Google erişim token'ı 60 dk geçerli; bitmesine 5 dk kala yenilenir. */
const ACCESS_TOKEN_MARGIN_MS = 5 * 60 * 1_000;

/** Android'de bildirimin düştüğü kanal — uygulamadaki `PushChannels` ile aynı kimlik. */
export const ANDROID_CHANNEL_ID = 'staff_notifications';

export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * FCM HTTP v1 — servis hesabıyla OAuth2 (JWT bearer), ek SDK yok.
 *
 * `firebase-admin` bilinçli olarak eklenmedi: tek bir uç için onlarca geçişli
 * bağımlılık ve kendi HTTP/kimlik katmanı getiriyordu. Akış iki çağrı:
 * imzalı JWT ile erişim token'ı al, `messages:send`e gönder.
 */
export class FcmPushSender {
  private readonly key: KeyObject;
  private accessToken: { value: string; expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;

  constructor(private readonly account: FcmServiceAccount) {
    this.key = createPrivateKey(account.private_key);
  }

  async send(device: PushDevice, message: PushMessage): Promise<PushOutcome> {
    let token: string;
    try {
      token = await this.token();
    } catch (error: unknown) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }

    const body = {
      message: {
        token: device.token,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: {
          priority: 'HIGH',
          ...(message.collapseKey === undefined ? {} : { collapse_key: message.collapseKey }),
          notification: {
            channel_id: ANDROID_CHANNEL_ID,
            // Kilit ekranında başlık görünür ama gövde gizlenir.
            visibility: 'PRIVATE',
            ...(message.collapseKey === undefined ? {} : { tag: message.collapseKey }),
          },
        },
      },
    };

    let response: Response;
    try {
      response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error: unknown) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }

    if (response.ok) return { status: 'sent' };
    const text = await response.text().catch(() => '');
    const code = fcmErrorCode(text);
    if (response.status === 404 || code === 'UNREGISTERED') return { status: 'invalid_token' };
    // Geçersiz biçimli anahtar da kalıcıdır; diğer INVALID_ARGUMENT'lar bizim hatamız.
    if (code === 'INVALID_ARGUMENT' && text.includes('registration token')) {
      return { status: 'invalid_token' };
    }
    if (response.status === 401) this.accessToken = undefined;
    return { status: 'failed', reason: `FCM ${response.status} ${code}` };
  }

  /** Tek uçuş: eş zamanlı gönderimler aynı token isteğini paylaşır. */
  private async token(): Promise<string> {
    const cached = this.accessToken;
    if (cached !== undefined && cached.expiresAt - ACCESS_TOKEN_MARGIN_MS > Date.now()) {
      return cached.value;
    }
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async fetchToken(): Promise<string> {
    const tokenUri = this.account.token_uri ?? DEFAULT_TOKEN_URI;
    const now = Math.floor(Date.now() / 1_000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: SCOPE,
        aud: tokenUri,
        iat: now,
        exp: now + 3_600,
      }),
    );
    const signature = sign('sha256', Buffer.from(`${header}.${claims}`), this.key);
    const assertion = `${header}.${claims}.${base64Url(signature)}`;

    const response = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`FCM kimlik doğrulaması başarısız (${response.status})`);
    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (typeof json.access_token !== 'string') throw new Error('FCM token yanıtı geçersiz');
    this.accessToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3_600) * 1_000,
    };
    return json.access_token;
  }
}

function fcmErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; details?: { errorCode?: string }[] };
    };
    return parsed.error?.details?.find((d) => d.errorCode)?.errorCode ?? parsed.error?.status ?? '';
  } catch {
    return '';
  }
}
