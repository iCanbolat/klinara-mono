import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Alan bazlı şifreleme (AES-256-GCM).
 *
 * Nerede kullanılır: hash'lenemeyen ama sır olan değerler — TOTP sırrı, ileride
 * alerji/anamnez alanları ve WhatsApp erişim token'ları. Parolalar buraya
 * GİRMEZ; onlar geri okunmaz, argon2id ile hash'lenir.
 *
 * GCM seçilmesinin sebebi kimlik doğrulamalı şifreleme olmasıdır: şifreli metin
 * kurcalanırsa çözme İŞLEMİ HATA VERİR, sessizce bozuk veri dönmez.
 *
 * Biçim: `<keyId>:<iv>:<tag>:<ciphertext>` (hepsi base64url). `keyId` satırda
 * durduğu için anahtar rotasyonunda eski satırlar okunmaya devam eder.
 */
@Injectable()
export class FieldEncryptionService {
  private readonly key: Buffer;
  readonly keyId: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const encoded: string = config.get('FIELD_ENCRYPTION_KEY', { infer: true });
    this.key = Buffer.from(encoded, 'base64');
    this.keyId = config.get('FIELD_ENCRYPTION_KEY_ID', { infer: true });
    if (this.key.length !== 32) {
      throw new Error('FIELD_ENCRYPTION_KEY 32 bayt olmalı (base64 kodlu)');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      this.keyId,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const [, ivPart, tagPart, dataPart] = payload.split(':');
    if (ivPart === undefined || tagPart === undefined || dataPart === undefined) {
      throw new Error('Şifreli alan biçimi geçersiz');
    }
    const tag = Buffer.from(tagPart, 'base64url');
    if (tag.length !== TAG_BYTES) throw new Error('Şifreli alan biçimi geçersiz');

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
