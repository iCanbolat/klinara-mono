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
      start: entry.openTime ?? entry.startTime ?? '09:00',
      end: entry.closeTime ?? entry.endTime ?? '18:00',
      breakStart: entry.breakStartTime ?? '',
      breakEnd: entry.breakEndTime ?? '',
    };
  });
}
