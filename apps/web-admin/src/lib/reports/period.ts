/**
 * Rapor dönemleri — saf, React'ten ve API'den bağımsız.
 *
 * Sunucu yarı açık `[from, to)` bekliyor (API sözleşmesi 5.5) ve kullanıcıya
 * gösterilen etiket KAPSAYICI ("1–30 Eylül"). İkisini karıştırmak raporun en
 * sinsi hatası olurdu: bir gün eksik ya da fazla, ama grafik yine de makul
 * görünür. Dönüşüm bu yüzden tek yerde ve test edilebilir.
 */

export interface PeriodRange {
  from: string;
  /** HARİÇ. */
  to: string;
}

export const PERIOD_PRESETS = ['thisMonth', 'lastMonth', 'last7', 'last30', 'thisYear'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  thisMonth: 'Bu ay',
  lastMonth: 'Geçen ay',
  last7: 'Son 7 gün',
  last30: 'Son 30 gün',
  thisYear: 'Bu yıl',
};

/**
 * Yerel gün başlangıcını ISO 8601 + offset olarak yazar.
 *
 * `toISOString()` KULLANILMIYOR: o UTC'ye çevirir ve `+03:00`ta olan bir
 * kullanıcı için "1 Eylül 00:00" isteği "31 Ağustos 21:00Z"ye dönüşür —
 * sunucu bunu doğru yorumlar ama kullanıcının seçtiği gün ile gönderilen
 * dizgenin görünen günü ayrışır ve hata ayıklaması cehennem olur.
 */
export function localDayIso(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T00:00:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

/** Ön ayarı yarı açık aralığa çevirir. `now` testler için verilebilir. */
export function presetRange(preset: PeriodPreset, now = new Date()): PeriodRange {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case 'lastMonth': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: localDayIso(from), to: localDayIso(to) };
    }
    case 'last7':
    case 'last30': {
      const days = preset === 'last7' ? 7 : 30;
      const from = new Date(startOfDay);
      from.setDate(from.getDate() - days + 1);
      // Bitiş YARIN: bugünü de kapsaması için. `to` hariç olduğundan bugünün
      // başlangıcını vermek, bugünü tamamen dışarıda bırakırdı.
      const to = new Date(startOfDay);
      to.setDate(to.getDate() + 1);
      return { from: localDayIso(from), to: localDayIso(to) };
    }
    case 'thisYear': {
      const from = new Date(now.getFullYear(), 0, 1);
      const to = new Date(startOfDay);
      to.setDate(to.getDate() + 1);
      return { from: localDayIso(from), to: localDayIso(to) };
    }
    default: {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(startOfDay);
      to.setDate(to.getDate() + 1);
      return { from: localDayIso(from), to: localDayIso(to) };
    }
  }
}

const DATE_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Kullanıcıya gösterilen KAPSAYICI etiket.
 *
 * Bitiş bir gün geri alınıyor: sunucuya "1 Ekim hariç" diyoruz ama kullanıcıya
 * "30 Eylül"e kadar diye göstermek gerekiyor. Aksi hâlde "Eylül raporu"
 * başlığının altında 1 Ekim yazardı.
 */
export function periodLabel(range: PeriodRange): string {
  const from = new Date(range.from);
  const inclusiveEnd = new Date(new Date(range.to).getTime() - 1);
  return `${DATE_FORMAT.format(from)} – ${DATE_FORMAT.format(inclusiveEnd)}`;
}

/** Sorgu dizgesi; offset'teki `+` kodlanmazsa BOŞLUĞA dönüşür ve doğrulama patlar. */
export function rangeQuery(range: PeriodRange, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ from: range.from, to: range.to, ...extra });
  return params.toString();
}
