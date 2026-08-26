import parsePhoneNumberFromString from 'libphonenumber-js';

/** Varsayılan ülke: kullanıcıların büyük çoğunluğu numarayı `05xx` yazar. */
const DEFAULT_COUNTRY = 'TR';

/**
 * Telefonu E.164'e normalize eder; geçersizse `null`.
 *
 * Normalizasyon giriş tanımlayıcısı olduğu için ZORUNLUDUR: `0532 123 45 67`,
 * `+90 532 123 45 67` ve `905321234567` aynı kişidir. Ham metin saklansaydı
 * tekillik indeksi işe yaramaz, kullanıcı numarasını başka yazdığında giriş
 * yapamazdı.
 */
export function normalizePhone(raw: string): string | null {
  try {
    const parsed = parsePhoneNumberFromString(raw.trim(), DEFAULT_COUNTRY);
    if (parsed === undefined || !parsed.isValid()) return null;
    return parsed.number;
  } catch {
    return null;
  }
}
