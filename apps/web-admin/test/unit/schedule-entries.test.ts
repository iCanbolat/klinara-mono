import { describe, expect, it } from 'vitest';
import {
  changedDays,
  copyDay,
  emptyWeek,
  formatHours,
  fromEntries,
  outsideBranchHours,
  parseTime,
  sameWeek,
  staffWeekFromBranch,
  toHm,
  workingMinutes,
  toBranchHours,
  toStaffSchedule,
  validateWeek,
  type DayDraft,
} from '../../src/lib/schedule/entries';

function week(overrides: Partial<DayDraft> & { dayOfWeek: number }): DayDraft[] {
  return emptyWeek().map((day) =>
    day.dayOfWeek === overrides.dayOfWeek ? { ...day, ...overrides } : day,
  );
}

describe('haftalık plan', () => {
  it('saat ayrıştırma', () => {
    expect(parseTime('09:00')).toBe(540);
    expect(parseTime('9:05')).toBe(545);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('09:60')).toBeNull();
    expect(parseTime('dokuz')).toBeNull();
  });

  it('gövde HER ZAMAN YEDİ GÜN taşıyor', () => {
    // ⚠️ `PUT` TAM DEĞİŞTİRME: eksik gönderilen gün SİLİNİR. Kapalı günü
    // listeden düşürmek, o günü yok etmek demek.
    const days = week({ dayOfWeek: 1, closed: false });
    const body = toBranchHours(days);

    expect(body).toHaveLength(7);
    expect(body.map((entry) => entry.dayOfWeek).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Kapalı günler bayrakla gidiyor.
    expect(body.filter((entry) => entry.isClosed)).toHaveLength(6);
  });

  it('personel planı da yedi gün ve `isOff` bayrağı taşıyor', () => {
    const body = toStaffSchedule(week({ dayOfWeek: 2, closed: false, start: '10:00', end: '16:00' }));
    expect(body).toHaveLength(7);

    const tuesday = body.find((entry) => entry.dayOfWeek === 2);
    expect(tuesday).toEqual({ dayOfWeek: 2, isOff: false, startTime: '10:00', endTime: '16:00' });
    expect(body.find((entry) => entry.dayOfWeek === 0)).toEqual({ dayOfWeek: 0, isOff: true });
  });

  it('kapalı günde saat GÖNDERİLMİYOR', () => {
    const closed = toBranchHours(emptyWeek())[0];
    expect(closed).toEqual({ dayOfWeek: 0, isClosed: true });
    expect(closed).not.toHaveProperty('openTime');
  });

  it('mola yalnız İKİSİ de doluysa gönderiliyor', () => {
    const withBreak = toBranchHours(
      week({ dayOfWeek: 1, closed: false, breakStart: '13:00', breakEnd: '14:00' }),
    ).find((entry) => entry.dayOfWeek === 1);
    expect(withBreak?.breakStartTime).toBe('13:00');

    const halfBreak = toBranchHours(
      week({ dayOfWeek: 1, closed: false, breakStart: '13:00', breakEnd: '' }),
    ).find((entry) => entry.dayOfWeek === 1);
    expect(halfBreak).not.toHaveProperty('breakStartTime');
  });
});

describe('plan doğrulaması', () => {
  it('kapalı gün doğrulanmıyor', () => {
    expect(validateWeek(emptyWeek())).toEqual([]);
  });

  it('kapanış açılıştan ÖNCEYSE gün adıyla hata', () => {
    // Sunucudan dönen hata yolu `entries.3.closeTime` olurdu ve kullanıcı
    // hangi güne ait olduğunu göremezdi. Günün adını burada söylüyoruz.
    const issues = validateWeek(week({ dayOfWeek: 3, closed: false, start: '18:00', end: '09:00' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.dayOfWeek).toBe(3);
    expect(issues[0]?.message).toContain('Kapanış');
  });

  it('eşit açılış/kapanış reddediliyor', () => {
    const issues = validateWeek(week({ dayOfWeek: 1, closed: false, start: '09:00', end: '09:00' }));
    expect(issues).toHaveLength(1);
  });

  it('molanın YALNIZ BİR UCU girilirse hata', () => {
    const issues = validateWeek(week({ dayOfWeek: 1, closed: false, breakStart: '13:00' }));
    expect(issues[0]?.message).toContain('birlikte');
  });

  it('mola çalışma saatleri DIŞINDAYSA hata', () => {
    const issues = validateWeek(
      week({
        dayOfWeek: 1,
        closed: false,
        start: '09:00',
        end: '18:00',
        breakStart: '19:00',
        breakEnd: '20:00',
      }),
    );
    expect(issues[0]?.message).toContain('çalışma saatleri içinde');
  });

  it('geçerli hafta hatasız', () => {
    const issues = validateWeek(
      week({
        dayOfWeek: 1,
        closed: false,
        start: '09:00',
        end: '18:00',
        breakStart: '13:00',
        breakEnd: '14:00',
      }),
    );
    expect(issues).toEqual([]);
  });
});

describe('sunucudan ızgaraya', () => {
  it('EKSİK gün KAPALI sayılıyor', () => {
    // Sunucu yalnız var olan satırları döndürüyor; eksik günü açık varsaymak
    // kullanıcıya "pazar da açığız" derdi.
    const days = fromEntries([
      { dayOfWeek: 1, isClosed: false, openTime: '10:00', closeTime: '19:00' },
    ]);

    expect(days).toHaveLength(7);
    expect(days.find((day) => day.dayOfWeek === 1)).toMatchObject({
      closed: false,
      start: '10:00',
      end: '19:00',
    });
    expect(days.filter((day) => day.closed)).toHaveLength(6);
  });

  it('personel planındaki `isOff` de kapalı demek', () => {
    const days = fromEntries([
      { dayOfWeek: 2, isOff: true },
      { dayOfWeek: 3, isOff: false, startTime: '11:00', endTime: '15:00' },
    ]);

    expect(days.find((day) => day.dayOfWeek === 2)?.closed).toBe(true);
    expect(days.find((day) => day.dayOfWeek === 3)).toMatchObject({
      closed: false,
      start: '11:00',
      end: '15:00',
    });
  });

  it('gidiş-dönüş kayıpsız', () => {
    const original = week({
      dayOfWeek: 1,
      closed: false,
      start: '08:30',
      end: '17:30',
      breakStart: '12:00',
      breakEnd: '13:00',
    });
    const roundTrip = fromEntries(
      toBranchHours(original).map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        isClosed: entry.isClosed,
        openTime: entry.openTime ?? null,
        closeTime: entry.closeTime ?? null,
        breakStartTime: entry.breakStartTime ?? null,
        breakEndTime: entry.breakEndTime ?? null,
      })),
    );

    expect(roundTrip.find((day) => day.dayOfWeek === 1)).toMatchObject({
      closed: false,
      start: '08:30',
      end: '17:30',
      breakStart: '12:00',
      breakEnd: '13:00',
    });
  });
});

describe('haftalık düzenleyici yardımcıları', () => {
  const open = (dayOfWeek: number, extra: Partial<DayDraft> = {}): Partial<DayDraft> & { dayOfWeek: number } => ({
    dayOfWeek,
    closed: false,
    start: '09:00',
    end: '18:00',
    ...extra,
  });

  it('sunucunun saniyeli saatleri kırpılıyor', () => {
    const [monday] = fromEntries([
      { dayOfWeek: 1, isClosed: false, openTime: '09:30:00', closeTime: '18:00:00', breakStartTime: '12:00:00', breakEndTime: '13:00:00' },
    ]).filter((day) => day.dayOfWeek === 1);
    expect(monday).toEqual(expect.objectContaining({ start: '09:30', end: '18:00', breakStart: '12:00', breakEnd: '13:00' }));
    expect(validateWeek(fromEntries([{ dayOfWeek: 1, isClosed: false, openTime: '09:30:00', closeTime: '18:00:00' }]))).toEqual([]);
    expect(toHm(null)).toBeNull();
  });

  it('kapalı günün gizli saat farkı DEĞİŞİKLİK sayılmıyor', () => {
    const saved = emptyWeek();
    const draft = saved.map((day) => (day.dayOfWeek === 3 ? { ...day, start: '07:00' } : day));
    expect(sameWeek(draft, saved)).toBe(true);
    const opened = saved.map((day) => (day.dayOfWeek === 3 ? { ...day, closed: false } : day));
    expect(changedDays(opened, saved)).toEqual([3]);
  });

  it('gün kopyalama yalnız hedeflere dokunuyor ve dayOfWeek korunuyor', () => {
    const days = week(open(1, { breakStart: '12:00', breakEnd: '13:00' }));
    const copied = copyDay(days, 1, [2, 3, 1]);
    expect(copied.find((day) => day.dayOfWeek === 2)).toEqual({ ...days[1], dayOfWeek: 2 });
    expect(copied.find((day) => day.dayOfWeek === 3)?.breakStart).toBe('12:00');
    expect(copied.find((day) => day.dayOfWeek === 4)?.closed).toBe(true);
    expect(copied.map((day) => day.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('net çalışma süresi molayı düşüyor', () => {
    const [monday] = week(open(1, { breakStart: '12:00', breakEnd: '13:30' })).filter((day) => day.dayOfWeek === 1);
    expect(workingMinutes(monday as DayDraft)).toBe(450);
    expect(formatHours(450)).toBe('7,5 sa');
    expect(workingMinutes(emptyWeek()[0] as DayDraft)).toBe(0);
  });

  it('personel planı şube saatleri dışına taşınca UYARI üretiyor', () => {
    const branch = week(open(1));
    const staff = emptyWeek().map((day) => {
      if (day.dayOfWeek === 1) return { ...day, closed: false, start: '08:00', end: '17:00' };
      if (day.dayOfWeek === 2) return { ...day, closed: false, start: '10:00', end: '16:00' };
      return day;
    });
    expect(outsideBranchHours(staff, branch)).toEqual([
      { dayOfWeek: 1, message: 'Şube saatleri (09:00–18:00) dışına taşıyor.' },
      { dayOfWeek: 2, message: 'Şube bu gün kapalı.' },
    ]);
    expect(staffWeekFromBranch(week(open(1, { breakStart: '12:00', breakEnd: '13:00' })))[1]?.breakStart).toBe('');
  });
});
