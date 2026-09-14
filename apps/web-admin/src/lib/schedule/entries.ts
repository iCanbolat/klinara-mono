/**
 * Haftalık plan ızgarası ↔ API `entries[]` dönüşümü — saf.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `PUT` TAM DEĞİŞTİRME
 * ---------------------------------------------------------------------------
 * `PUT /branches/:id/hours` ve `PUT /staff/:id/schedule` gönderilen diziyi
 * OLDUĞU GİBİ yazıyor. Eksik gönderilen bir gün SİLİNİR — yani "yalnız
 * değişeni gönder" yaklaşımı burada **veri silmek** demektir.
 *
 * Bu yüzden `toEntries` HER ZAMAN yedi gün üretiyor; kapalı günler
 * `isClosed`/`isOff` bayrağıyla gidiyor, listeden düşürülerek değil.
 */

/** 0 = Pazar … 6 = Cumartesi (PostgreSQL `dow` ile aynı). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Arayüz sırası: hafta PAZARTESİ başlar, veri sırası pazar. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const WEEKDAY_LABEL: Record<number, string> = {
  0: 'Pazar',
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
};

/** Dar alanlar (özet çizelgesi, kopyalama seçici) için. */
export const WEEKDAY_SHORT: Record<number, string> = {
  0: 'Paz',
  1: 'Pzt',
  2: 'Sal',
  3: 'Çar',
  4: 'Per',
  5: 'Cum',
  6: 'Cmt',
};

/** Hızlı seçimler — kopyalama ve tekrarlayan izin. */
export const WEEKDAY_GROUPS = {
  weekdays: [1, 2, 3, 4, 5],
  weekend: [6, 0],
  all: [1, 2, 3, 4, 5, 6, 0],
} as const;

export interface DayDraft {
  dayOfWeek: number;
  closed: boolean;
  /** `HH:MM`. Kapalı günde yok sayılıyor. */
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
}

export function emptyWeek(): DayDraft[] {
  return WEEKDAYS.map((dayOfWeek) => ({
    dayOfWeek,
    closed: true,
    start: '09:00',
    end: '18:00',
    breakStart: '',
    breakEnd: '',
  }));
}

/** `HH:MM` → gün içi dakika; geçersizse `null`. */
export function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number.parseInt(match[1] ?? '', 10);
  const minutes = Number.parseInt(match[2] ?? '', 10);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export interface DayIssue {
  dayOfWeek: number;
  message: string;
}

/**
 * Gönderilmeden ÖNCE yakalanabilecek tutarsızlıklar.
 *
 * İstemci tarafı şema doğrulaması yok (otorite sunucu) ama BURADAKİLER
 * doğrulama değil, ARİTMETİK: "kapanış açılıştan önce" hatası sunucudan
 * dönerse kullanıcı hangi güne ait olduğunu göremez — `entries[]` bir dizi
 * ve hata yolu `entries.3.closeTime` olur. Günün adını burada söylüyoruz.
 */
export function validateWeek(days: readonly DayDraft[]): DayIssue[] {
  const issues: DayIssue[] = [];

  for (const day of days) {
    if (day.closed) continue;

    const open = parseTime(day.start);
    const close = parseTime(day.end);

    if (open === null || close === null) {
      issues.push({ dayOfWeek: day.dayOfWeek, message: 'Saat biçimi SS:DD olmalı.' });
      continue;
    }
    if (close <= open) {
      issues.push({ dayOfWeek: day.dayOfWeek, message: 'Kapanış açılıştan sonra olmalı.' });
      continue;
    }

    const hasBreakStart = day.breakStart.trim() !== '';
    const hasBreakEnd = day.breakEnd.trim() !== '';
    if (hasBreakStart !== hasBreakEnd) {
      issues.push({ dayOfWeek: day.dayOfWeek, message: 'Molanın başı ve sonu birlikte girilmeli.' });
      continue;
    }
    if (!hasBreakStart) continue;

    const breakStart = parseTime(day.breakStart);
    const breakEnd = parseTime(day.breakEnd);
    if (breakStart === null || breakEnd === null) {
      issues.push({ dayOfWeek: day.dayOfWeek, message: 'Mola saati biçimi SS:DD olmalı.' });
      continue;
    }
    if (breakEnd <= breakStart) {
      issues.push({ dayOfWeek: day.dayOfWeek, message: 'Mola sonu molanın başından sonra olmalı.' });
      continue;
    }
    if (breakStart < open || breakEnd > close) {
      issues.push({ dayOfWeek: day.dayOfWeek, message: 'Mola çalışma saatleri içinde olmalı.' });
    }
  }

  return issues;
}

interface BranchHourEntry {
  dayOfWeek: number;
  isClosed: boolean;
  openTime?: string;
  closeTime?: string;
  breakStartTime?: string;
  breakEndTime?: string;
}

/**
 * Şube saatleri gövdesi — HER ZAMAN yedi gün.
 *
 * Kapalı gün listeden DÜŞÜRÜLMÜYOR, `isClosed: true` ile gönderiliyor:
 * `PUT` tam değiştirme olduğu için düşürülen bir gün silinmiş sayılır ve
 * sonraki okumada hiç görünmez.
 */
export function toBranchHours(days: readonly DayDraft[]): BranchHourEntry[] {
  return days.map((day) => {
    if (day.closed) return { dayOfWeek: day.dayOfWeek, isClosed: true };
    const hasBreak = day.breakStart.trim() !== '' && day.breakEnd.trim() !== '';
    return {
      dayOfWeek: day.dayOfWeek,
      isClosed: false,
      openTime: day.start,
      closeTime: day.end,
      ...(hasBreak ? { breakStartTime: day.breakStart, breakEndTime: day.breakEnd } : {}),
    };
  });
}

interface StaffScheduleEntryInput {
  dayOfWeek: number;
  isOff: boolean;
  startTime?: string;
  endTime?: string;
}

/** Personel planı gövdesi — aynı kural: her zaman yedi gün. */
export function toStaffSchedule(days: readonly DayDraft[]): StaffScheduleEntryInput[] {
  return days.map((day) =>
    day.closed
      ? { dayOfWeek: day.dayOfWeek, isOff: true }
      : { dayOfWeek: day.dayOfWeek, isOff: false, startTime: day.start, endTime: day.end },
  );
}

/**
 * Sunucu saatleri `time` kolonundan `'09:00:00'` olarak dönüyor; `PUT` ise
 * `HH:MM` istiyor ve `parseTime` saniyeli değeri reddediyor. Kırpılmazsa
 * yüklenen her açık gün "saat biçimi" hatası verir ve kaydet kilitlenirdi.
 */
export function toHm(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.slice(0, 5);
}

/** Sunucudan gelen kayıtları ızgaraya çevirir; eksik gün KAPALI sayılır. */
export function fromEntries(
  entries: readonly {
    dayOfWeek: number;
    isClosed?: boolean;
    isOff?: boolean;
    openTime?: string | null;
    closeTime?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    breakStartTime?: string | null;
    breakEndTime?: string | null;
  }[],
): DayDraft[] {
  const byDay = new Map(entries.map((entry) => [entry.dayOfWeek, entry]));

  return WEEKDAYS.map((dayOfWeek) => {
    const entry = byDay.get(dayOfWeek);
    if (entry === undefined) {
      return {
        dayOfWeek,
        closed: true,
        start: '09:00',
        end: '18:00',
        breakStart: '',
        breakEnd: '',
      };
    }
    return {
      dayOfWeek,
      closed: entry.isClosed === true || entry.isOff === true,
      start: toHm(entry.openTime ?? entry.startTime) ?? '09:00',
      end: toHm(entry.closeTime ?? entry.endTime) ?? '18:00',
      breakStart: toHm(entry.breakStartTime) ?? '',
      breakEnd: toHm(entry.breakEndTime) ?? '',
    };
  });
}

// ---------------------------------------------------------------------------
// Düzenleyici yardımcıları
// ---------------------------------------------------------------------------

/**
 * İki hafta AYNI mı — kaydedilmemiş değişiklik göstergesi için.
 *
 * Kapalı bir günün saat alanları gönderilmiyor (`toBranchHours`), dolayısıyla
 * onları karşılaştırmak "kapat, saati değiştir, geri aç" gibi gönderilmeyecek
 * farkları da kirli sayardı. Kapalı günlerde yalnız bayrak karşılaştırılıyor.
 */
export function sameWeek(a: readonly DayDraft[], b: readonly DayDraft[]): boolean {
  return changedDays(a, b).length === 0;
}

/** Değişen günler (veri sırasıyla `dayOfWeek`). */
export function changedDays(a: readonly DayDraft[], b: readonly DayDraft[]): number[] {
  const byDay = new Map(b.map((day) => [day.dayOfWeek, day]));
  const changed: number[] = [];
  for (const left of a) {
    const right = byDay.get(left.dayOfWeek);
    if (right === undefined || !sameDay(left, right)) changed.push(left.dayOfWeek);
  }
  return changed;
}

function sameDay(a: DayDraft, b: DayDraft): boolean {
  if (a.closed !== b.closed) return false;
  if (a.closed) return true;
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.breakStart.trim() === b.breakStart.trim() &&
    a.breakEnd.trim() === b.breakEnd.trim()
  );
}

/**
 * Bir günün planını başka günlere kopyalar. Kaynak gün hedeflerde olsa bile
 * dokunulmuyor; `dayOfWeek` her zaman hedefin kendisi kalıyor.
 */
export function copyDay(
  days: readonly DayDraft[],
  sourceDay: number,
  targetDays: readonly number[],
): DayDraft[] {
  const source = days.find((day) => day.dayOfWeek === sourceDay);
  if (source === undefined) return [...days];
  const targets = new Set(targetDays);
  return days.map((day) =>
    day.dayOfWeek !== sourceDay && targets.has(day.dayOfWeek)
      ? { ...source, dayOfWeek: day.dayOfWeek }
      : day,
  );
}

/** Günün net çalışma dakikası (mola düşülmüş); kapalı ya da geçersizse 0. */
export function workingMinutes(day: DayDraft): number {
  if (day.closed) return 0;
  const open = parseTime(day.start);
  const close = parseTime(day.end);
  if (open === null || close === null || close <= open) return 0;
  const breakStart = parseTime(day.breakStart);
  const breakEnd = parseTime(day.breakEnd);
  const breakMinutes =
    breakStart !== null && breakEnd !== null && breakEnd > breakStart
      ? Math.min(breakEnd, close) - Math.max(breakStart, open)
      : 0;
  return close - open - Math.max(0, breakMinutes);
}

/** `510` → `'8,5 sa'`, `480` → `'8 sa'`. */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(hours)} sa`;
}

/**
 * Personel planının şube saatleri DIŞINA taştığı günler.
 *
 * ENGELLEYİCİ DEĞİL, UYARI: sunucu buna izin veriyor ve uygunluk motoru
 * zaten iki aralığın KESİŞİMİNİ kullanıyor. Yani 08:00'de başlayan personel
 * 09:00'da açılan şubede 09:00'dan önce randevu alamaz — kullanıcı bunu
 * kaydetmeden önce görmeli, yoksa "neden 08:00 slotu yok" diye sorar.
 */
export function outsideBranchHours(
  staffDays: readonly DayDraft[],
  branchDays: readonly DayDraft[],
): DayIssue[] {
  const branchByDay = new Map(branchDays.map((day) => [day.dayOfWeek, day]));
  const issues: DayIssue[] = [];

  for (const day of staffDays) {
    if (day.closed) continue;
    const branch = branchByDay.get(day.dayOfWeek);
    if (branch === undefined) continue;
    if (branch.closed) {
      issues.push({ dayOfWeek: day.dayOfWeek, message: 'Şube bu gün kapalı.' });
      continue;
    }
    const start = parseTime(day.start);
    const end = parseTime(day.end);
    const open = parseTime(branch.start);
    const close = parseTime(branch.end);
    if (start === null || end === null || open === null || close === null) continue;
    if (start < open || end > close) {
      issues.push({
        dayOfWeek: day.dayOfWeek,
        message: `Şube saatleri (${branch.start}–${branch.end}) dışına taşıyor.`,
      });
    }
  }

  return issues;
}

/** Şube saatlerinden personel planı: mola personel planında yok. */
export function staffWeekFromBranch(branchDays: readonly DayDraft[]): DayDraft[] {
  return branchDays.map((day) => ({ ...day, breakStart: '', breakEnd: '' }));
}
