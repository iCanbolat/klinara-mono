import { createHash } from 'node:crypto';
import type { Response } from 'express';

/**
 * CDN cache validator'ı.
 *
 * `common/http/etag.ts`teki `weakETag(version)` ile AYNI ŞEY DEĞİLDİR ve
 * karıştırılmamalı: o, iyimser kilit token'ıdır ve `If-Match` ile tüketilir;
 * bu ise içerik doğrulayıcısıdır ve `If-None-Match` ile tüketilir. Birini
 * diğerinin yerine koymak, cache doğrulamasını 428 fırtınasına çevirirdi.
 */
export function contentETag(revisionNumber: number, contentHash: string): string {
  return `W/"r${revisionNumber}-${contentHash.slice(0, 16)}"`;
}

/** Sürüm numarası olmayan yanıtlar (uygunluk gibi) için gövdeden türetilen validator. */
export function payloadETag(payload: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `W/"p-${hash.slice(0, 16)}"`;
}

export interface CachePolicy {
  /** Tarayıcı cache'i (saniye). */
  maxAge: number;
  /** Paylaşımlı cache / CDN (saniye). */
  sMaxAge: number;
  staleWhileRevalidate?: number;
}

export function applyCache(response: Response, policy: CachePolicy, etag: string): void {
  const parts = [`public`, `max-age=${policy.maxAge}`, `s-maxage=${policy.sMaxAge}`];
  if (policy.staleWhileRevalidate !== undefined) {
    parts.push(`stale-while-revalidate=${policy.staleWhileRevalidate}`);
  }
  response.setHeader('Cache-Control', parts.join(', '));
  response.setHeader('ETag', etag);
  response.setHeader('Vary', 'Accept-Encoding');
}

/**
 * `If-None-Match` eşleşmesi.
 *
 * Zayıf validator karşılaştırması: `W/` öneki kırpılarak karşılaştırılır,
 * çünkü bazı ara katmanlar öneki düşürüyor. Liste biçimi (`a, b`) de kabul
 * edilir — tarayıcılar birden çok validator gönderebilir.
 */
export function matchesETag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//, '');
  const target = normalize(etag);
  return ifNoneMatch.split(',').some((candidate) => normalize(candidate) === target);
}
