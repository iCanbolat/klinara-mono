import { describe, it, expect } from 'vitest';
import { layoutLanes, type LayoutInput, type LayoutResult } from '../../src/lib/calendar/layout';

/** Sonucu id → satır olarak arar; sıralama iddiaya karışmasın. */
const by = (rows: LayoutResult[], id: string): LayoutResult => {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`sonuçta ${id} yok`);
  return row;
};

const at = (id: string, startMin: number, endMin: number): LayoutInput => ({
  id,
  startMin,
  endMin,
});

describe('şerit yerleşimi', () => {
  it('boş girdi boş sonuç verir', () => {
    expect(layoutLanes([])).toEqual([]);
  });

  it('çakışmayan kayıtların hepsi TEK şeritte ve tam genişlikte', () => {
    const rows = layoutLanes([at('a', 540, 570), at('b', 600, 630), at('c', 660, 690)]);
    for (const id of ['a', 'b', 'c']) {
      expect(by(rows, id).lane).toBe(0);
      expect(by(rows, id).laneCount).toBe(1);
    }
  });

  it('SIRT SIRTA kayıtlar çakışmaz', () => {
    // Yarı açık aralık: 10:00'da biten ile 10:00'da başlayan kesişmez.
    // Sunucudaki EXCLUDE constraint'i de `[)` kullanıyor; iki taraf aynı
    // konvansiyonda olmalı.
    const rows = layoutLanes([at('a', 540, 600), at('b', 600, 660)]);
    expect(by(rows, 'a').lane).toBe(0);
    expect(by(rows, 'b').lane).toBe(0);
    expect(by(rows, 'a').laneCount).toBe(1);
  });

  it('kısmen çakışan iki kayıt yan yana düşer', () => {
    const rows = layoutLanes([at('a', 540, 600), at('b', 570, 630)]);
    expect(by(rows, 'a').lane).toBe(0);
    expect(by(rows, 'b').lane).toBe(1);
    // ASIL İDDİA: ikisi de AYNI genişlikte. Farklı olsalar ızgarada boşluk
    // ya da taşma olurdu.
    expect(by(rows, 'a').laneCount).toBe(2);
    expect(by(rows, 'b').laneCount).toBe(2);
  });

  it('TAM örtüşen kayıtlar ayrı şeritlere düşer', () => {
    const rows = layoutLanes([at('a', 540, 600), at('b', 540, 600), at('c', 540, 600)]);
    expect(new Set([by(rows, 'a').lane, by(rows, 'b').lane, by(rows, 'c').lane])).toEqual(
      new Set([0, 1, 2]),
    );
    expect(by(rows, 'a').laneCount).toBe(3);
  });

  it('ÜÇLÜ zincirde genişlik tüm küme boyunca aynıdır', () => {
    // a—b kesişiyor, b—c kesişiyor, ama a—c KESİŞMİYOR. Naif bir çözüm
    // a ve c'ye 2, b'ye 3 verirdi; küme boyunca genişlik aynı olmalı.
    const rows = layoutLanes([at('a', 540, 600), at('b', 570, 660), at('c', 630, 690)]);
    expect(by(rows, 'a').laneCount).toBe(2);
    expect(by(rows, 'b').laneCount).toBe(2);
    expect(by(rows, 'c').laneCount).toBe(2);
    // a ve c kesişmediği için c, a'nın şeridini geri kullanabilir.
    expect(by(rows, 'a').lane).toBe(0);
    expect(by(rows, 'b').lane).toBe(1);
    expect(by(rows, 'c').lane).toBe(0);
  });

  it('ayrı kümeler BİRBİRİNİN genişliğini etkilemez', () => {
    // Sabah üçlü çakışma, öğleden sonra tek randevu. Öğleden sonraki
    // randevu 1/3 genişlikte çizilirse ekran saçmalar.
    const rows = layoutLanes([
      at('s1', 540, 600),
      at('s2', 540, 600),
      at('s3', 540, 600),
      at('tek', 840, 900),
    ]);
    expect(by(rows, 's1').laneCount).toBe(3);
    expect(by(rows, 'tek').laneCount).toBe(1);
    expect(by(rows, 'tek').lane).toBe(0);
  });

  it('SIFIR süreli kayıt görünür kalır ve komşusuyla çakışır', () => {
    // Sıfır süreli bir kayıt hiçbir şeyle kesişmez ve görünmez çizilirdi.
    const rows = layoutLanes([at('sifir', 540, 540), at('normal', 540, 600)]);
    expect(rows).toHaveLength(2);
    expect(by(rows, 'sifir').laneCount).toBe(2);
    expect(by(rows, 'normal').laneCount).toBe(2);
  });

  it('TERS süreli kayıt (bitiş < başlangıç) sonucu bozmaz', () => {
    const rows = layoutLanes([at('bozuk', 600, 540), at('normal', 700, 730)]);
    expect(rows).toHaveLength(2);
    expect(by(rows, 'bozuk').lane).toBe(0);
    expect(by(rows, 'normal').lane).toBe(0);
  });

  it('sıralama KARARLI — girdi sırası sonucu değiştirmez', () => {
    const entries = [at('a', 540, 600), at('b', 570, 630), at('c', 600, 660)];
    const forward = layoutLanes(entries);
    const backward = layoutLanes([...entries].reverse());
    for (const id of ['a', 'b', 'c']) {
      expect(by(backward, id)).toEqual(by(forward, id));
    }
  });

  it('eşit başlangıçta UZUN olan ilk şeride geçer', () => {
    // Kısa olan sola düşseydi gereksiz bir şerit daha açılırdı.
    const rows = layoutLanes([at('kisa', 540, 560), at('uzun', 540, 660)]);
    expect(by(rows, 'uzun').lane).toBe(0);
    expect(by(rows, 'kisa').lane).toBe(1);
  });

  it('her kayıt sonuçta TAM BİR KEZ görünür', () => {
    const entries = Array.from({ length: 40 }, (_, i) => at(`x${i}`, i * 5, i * 5 + 45));
    const rows = layoutLanes(entries);
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((r) => r.id)).size).toBe(40);
  });

  it('aynı şeritteki iki kayıt ASLA çakışmaz', () => {
    // Yerleşimin tek gerçek doğruluk şartı bu; rastgele bir kümede
    // doğrudan sınanıyor.
    const entries: LayoutInput[] = [];
    let seed = 7;
    for (let i = 0; i < 60; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const start = seed % 900;
      entries.push(at(`r${i}`, start, start + 15 + (seed % 90)));
    }
    const rows = layoutLanes(entries);
    const spans = new Map(entries.map((e) => [e.id, e]));

    for (const a of rows) {
      for (const b of rows) {
        if (a.id === b.id || a.lane !== b.lane) continue;
        const x = spans.get(a.id);
        const y = spans.get(b.id);
        if (x === undefined || y === undefined) continue;
        const overlaps = x.startMin < y.endMin && y.startMin < x.endMin;
        expect(overlaps, `${a.id} ile ${b.id} aynı şeritte çakışıyor`).toBe(false);
      }
    }
  });
});
