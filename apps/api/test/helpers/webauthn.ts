import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * Yazılımsal WebAuthn authenticator'ı.
 *
 * Passkey akışını GERÇEKTEN sınamanın tek yolu bu: sunucu tarafı imzayı
 * kriptografik olarak doğruluyor, dolayısıyla testin de gerçek bir P-256
 * anahtarıyla imza üretmesi gerekiyor. Sahte bir yanıt gövdesi doğrulamadan
 * geçemez — testin değeri de buradan geliyor.
 *
 * Cihazın yaptığı işin aynısını yapar: anahtar çifti üretir, `authenticatorData`
 * kurar, `clientDataJSON` ile birlikte imzalar. Attestation kullanılmaz
 * (`fmt: "none"`) — sunucu da istemiyor.
 */

// ---------------------------------------------------------------------------
// Asgari CBOR kodlayıcı (yalnız burada gereken tipler)
// ---------------------------------------------------------------------------

function head(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 0x100) return Buffer.from([(major << 5) | 24, value]);
  if (value < 0x10000) {
    const buffer = Buffer.alloc(3);
    buffer[0] = (major << 5) | 25;
    buffer.writeUInt16BE(value, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = (major << 5) | 26;
  buffer.writeUInt32BE(value, 1);
  return buffer;
}

const cborUint = (value: number): Buffer => head(0, value);
/**
 * CBOR negatif tamsayı.
 *
 * `-n` değeri major type 1 ve argüman `n - 1` ile kodlanır: -7 → 0x26.
 * (COSE anahtarında alg=-7 ve koordinat etiketleri -1/-2/-3 bu yolla yazılır.)
 */
const cborNegative = (magnitude: number): Buffer => head(1, magnitude - 1);
const cborBytes = (value: Buffer): Buffer => Buffer.concat([head(2, value.length), value]);
const cborText = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([head(3, bytes.length), bytes]);
};
const cborMap = (entries: [Buffer, Buffer][]): Buffer =>
  Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, value]) => [key, value])]);

/** COSE_Key (ES256): kty=EC2, alg=-7, crv=P-256, x, y. */
function coseKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  return cborMap([
    [cborUint(1), cborUint(2)],
    [cborUint(3), cborNegative(7)],
    [cborNegative(1), cborUint(1)],
    [cborNegative(2), cborBytes(Buffer.from(jwk.x, 'base64url'))],
    [cborNegative(3), cborBytes(Buffer.from(jwk.y, 'base64url'))],
  ]);
}

// ---------------------------------------------------------------------------

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

function authenticatorData(
  rpId: string,
  flags: number,
  counter: number,
  attested?: Buffer,
): Buffer {
  const header = Buffer.alloc(37);
  createHash('sha256').update(rpId).digest().copy(header, 0);
  header[32] = flags;
  header.writeUInt32BE(counter, 33);
  return attested === undefined ? header : Buffer.concat([header, attested]);
}

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

export interface AuthenticatorOptions {
  rpId?: string;
  origin?: string;
}

export class SoftwareAuthenticator {
  private readonly rpId: string;
  private readonly origin: string;
  private readonly credentialId = randomBytes(32);
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  /** Gerçek authenticator'lar gibi her imzada artan sayaç. */
  private counter = 0;

  constructor(options: AuthenticatorOptions = {}) {
    this.rpId = options.rpId ?? 'localhost';
    this.origin = options.origin ?? 'http://localhost:5173';
  }

  get id(): string {
    return this.credentialId.toString('base64url');
  }

  /** `navigator.credentials.create()` karşılığı. */
  register(challenge: string): Record<string, unknown> {
    this.counter += 1;
    const publicKey = this.keys.publicKey;

    const attestedData = Buffer.concat([
      Buffer.alloc(16), // aaguid — attestation yok, sıfır
      (() => {
        const length = Buffer.alloc(2);
        length.writeUInt16BE(this.credentialId.length, 0);
        return length;
      })(),
      this.credentialId,
      coseKey(publicKey),
    ]);

    const authData = authenticatorData(
      this.rpId,
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_DATA,
      this.counter,
      attestedData,
    );

    const attestationObject = cborMap([
      [cborText('fmt'), cborText('none')],
      [cborText('attStmt'), cborMap([])],
      [cborText('authData'), cborBytes(authData)],
    ]);

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientData('webauthn.create', challenge, this.origin).toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  /**
   * `navigator.credentials.get()` karşılığı.
   *
   * `counterOverride` klonlanmış cihaz senaryosunu taklit etmek için: sayaç
   * gerilerse sunucu doğrulamayı reddetmelidir.
   */
  authenticate(challenge: string, counterOverride?: number): Record<string, unknown> {
    this.counter = counterOverride ?? this.counter + 1;

    const authData = authenticatorData(
      this.rpId,
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      this.counter,
    );
    const clientDataJSON = clientData('webauthn.get', challenge, this.origin);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]),
      this.keys.privateKey,
    );

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authData.toString('base64url'),
        signature: signature.toString('base64url'),
      },
    };
  }
}
