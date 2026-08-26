/**
 * `15m`, `30d`, `900s` biçimindeki süreleri saniyeye çevirir.
 *
 * jose token ömürlerini bu biçimde alır; aynı değeri veritabanına yazılacak
 * `expires_at` için de kullanmamız gerekir. Tek bir yerde çözümlenir ki
 * "token 15 dakika, satır 30 gün" sınıfı sapmalar mümkün olmasın.
 */
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
  y: 31_557_600,
};

export function durationToSeconds(value: string): number {
  const match = /^(\d+)\s?([a-z]+)$/i.exec(value.trim());
  if (match === null) throw new Error(`Geçersiz süre biçimi: ${value}`);
  const amount = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase()[0] ?? '';
  const seconds = UNIT_SECONDS[unit];
  if (seconds === undefined) throw new Error(`Geçersiz süre birimi: ${value}`);
  return amount * seconds;
}

export function durationFromNow(value: string): Date {
  return new Date(Date.now() + durationToSeconds(value) * 1_000);
}
