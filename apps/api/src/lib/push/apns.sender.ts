import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { PinoLogger } from 'nestjs-pino';
import {
  base64Url,
  type PushDevice,
  type PushEnvironment,
  type PushMessage,
  type PushOutcome,
} from './push.types';

const HOSTS: Record<PushEnvironment, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

/** Apple token'ı 20–60 dk arasında yenilenmesini istiyor; daha sık yenileme 429 alır. */
const JWT_TTL_MS = 50 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Bu yanıtlar anahtarın kalıcı olarak öldüğünü söyler. */
const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** `.p8` dosyasının içeriği (PEM). */
  privateKey: string;
  /** Uygulamanın bundle kimliği — `apns-topic`. */
  bundleId: string;
}

/**
 * APNs — token tabanlı kimlik (`.p8`), HTTP/2.
 *
 * Tek anahtar hem geliştirme hem canlı uç noktasında geçer; hangi uca
 * gidileceğini cihaz kaydındaki `environment` belirler (Xcode'dan kurulan
 * derleme sandbox, TestFlight/App Store canlı).
 *
 * Bağlantı ortam başına AÇIK TUTULUR: Apple her bildirim için yeni TLS
 * bağlantısı açmayı kötüye kullanım sayabiliyor.
 */
export class ApnsPushSender {
  private readonly key: KeyObject;
  private jwt: { value: string; issuedAt: number } | undefined;
  private readonly sessions = new Map<PushEnvironment, ClientHttp2Session>();

  constructor(
    private readonly config: ApnsConfig,
    private readonly logger: PinoLogger,
  ) {
    this.key = createPrivateKey(config.privateKey);
  }

  async send(device: PushDevice, message: PushMessage): Promise<PushOutcome> {
    const payload = JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: 'default',
        // Bildirim merkezinde uygulama başına gruplansın.
        'thread-id': message.collapseKey ?? 'klinara',
      },
      ...message.data,
    });

    const headers: Record<string, string> = {
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${device.token}`,
      authorization: `bearer ${this.token()}`,
      'apns-topic': this.config.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    };
    if (message.collapseKey !== undefined) headers['apns-collapse-id'] = message.collapseKey.slice(0, 64);

    let response: { status: number; body: string };
    try {
      response = await this.request(device.environment, headers, payload);
    } catch (error: unknown) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }

    if (response.status === 200) return { status: 'sent' };
    const reason = apnsReason(response.body);
    if (response.status === 410 || DEAD_TOKEN_REASONS.has(reason)) return { status: 'invalid_token' };
    if (reason === 'ExpiredProviderToken') this.jwt = undefined;
    return { status: 'failed', reason: `APNs ${response.status} ${reason}` };
  }

  close(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }

  private token(): string {
    const now = Date.now();
    if (this.jwt !== undefined && now - this.jwt.issuedAt < JWT_TTL_MS) return this.jwt.value;

    const header = base64Url(JSON.stringify({ alg: 'ES256', kid: this.config.keyId }));
    const claims = base64Url(
      JSON.stringify({ iss: this.config.teamId, iat: Math.floor(now / 1_000) }),
    );
    // JWS ES256 imzası DER değil, düz r||s (64 bayt) ister.
    const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
      key: this.key,
      dsaEncoding: 'ieee-p1363',
    });
    const value = `${header}.${claims}.${base64Url(signature)}`;
    this.jwt = { value, issuedAt: now };
    return value;
  }

  private session(environment: PushEnvironment): ClientHttp2Session {
    const existing = this.sessions.get(environment);
    if (existing !== undefined && !existing.closed && !existing.destroyed) return existing;

    const session = connect(HOSTS[environment]);
    session.on('error', (error: Error) => {
      this.logger.warn({ err: error, environment }, 'APNs bağlantısı koptu');
    });
    session.on('close', () => {
      if (this.sessions.get(environment) === session) this.sessions.delete(environment);
    });
    // Boşta kalan bağlantı süreci ayakta tutmasın.
    session.unref();
    this.sessions.set(environment, session);
    return session;
  }

  private request(
    environment: PushEnvironment,
    headers: Record<string, string>,
    payload: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const stream = this.session(environment).request(headers);
      let status = 0;
      let body = '';
      stream.setEncoding('utf8');
      stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
        stream.close(constants.NGHTTP2_CANCEL);
        reject(new Error('APNs zaman aşımı'));
      });
      stream.on('response', (responseHeaders) => {
        status = Number(responseHeaders[constants.HTTP2_HEADER_STATUS] ?? 0);
      });
      stream.on('data', (chunk: string) => {
        body += chunk;
      });
      stream.on('end', () => resolve({ status, body }));
      stream.on('error', reject);
      stream.end(payload);
    });
  }
}

function apnsReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    return typeof parsed.reason === 'string' ? parsed.reason : '';
  } catch {
    return '';
  }
}
