import 'server-only';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import {
  accessCookie,
  challengeCookie,
  clearAll,
  clearChallenge,
  COOKIE_NAMES,
  refreshCookie,
  type AccessPayload,
  type ChallengePayload,
  type CookieSpec,
  type RefreshPayload,
} from './cookies';
import { seal, unseal } from './seal';
import type { SessionPlan } from './login-step';

/**
 * Mühürlü cookie'lerin okunup yazılması — `cookies.ts`'in şartnamesini Next'in
 * API'sine bağlayan ince katman.
 *
 * Ayrı durmasının sebebi test edilebilirlik: şartname (hangi bayrak) ve mühür
 * (nasıl şifrelenir) saf modüllerde, çerçeveye bağlı olan yalnız bu dosya.
 */

export async function readAccess(): Promise<AccessPayload | null> {
  const raw = (await cookies()).get(COOKIE_NAMES.access)?.value;
  return raw === undefined ? null : unseal<AccessPayload>(raw, 'at');
}

export async function readRefresh(): Promise<RefreshPayload | null> {
  const raw = (await cookies()).get(COOKIE_NAMES.refresh)?.value;
  return raw === undefined ? null : unseal<RefreshPayload>(raw, 'rt');
}

export async function readChallenge(): Promise<ChallengePayload | null> {
  const raw = (await cookies()).get(COOKIE_NAMES.challenge)?.value;
  return raw === undefined ? null : unseal<ChallengePayload>(raw, 'ch');
}

/** Bir şartnameyi yanıta uygula. */
export function applyCookie(response: NextResponse, spec: CookieSpec): void {
  response.cookies.set({
    name: spec.name,
    value: spec.value,
    httpOnly: spec.httpOnly,
    secure: spec.secure,
    sameSite: spec.sameSite,
    path: spec.path,
    ...(spec.maxAge === undefined ? {} : { maxAge: spec.maxAge }),
  });
}

export function applyCookies(response: NextResponse, specs: CookieSpec[]): void {
  for (const spec of specs) applyCookie(response, spec);
}

/**
 * Oturum planını yanıta yaz.
 *
 * Plan `login-step.ts`'in saf çıktısı; burada yalnız mühürleme ve yazma var.
 * Handler'ın kendi kararı kalmıyor — "hangi durumda hangi cookie" sorusunun
 * cevabı tek yerde duruyor.
 */
export async function applyPlan(response: NextResponse, plan: SessionPlan): Promise<void> {
  if (plan.access !== undefined) {
    applyCookie(response, accessCookie(await seal(plan.access, 'at')));
  }
  if (plan.refresh !== undefined) {
    applyCookie(response, refreshCookie(await seal(plan.refresh, 'rt')));
  }
  if (plan.challenge !== undefined) {
    applyCookie(response, challengeCookie(await seal(plan.challenge, 'ch')));
  }
  if (plan.clearChallenge && plan.challenge === undefined) {
    applyCookie(response, clearChallenge());
  }
}

/** Oturumu tamamen sil — çıkış ve `TOKEN_INVALID` yolunda. */
export function applyClearAll(response: NextResponse): void {
  applyCookies(response, clearAll());
}
