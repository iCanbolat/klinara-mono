'use client';

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Grafik sarmalayıcısı — `recharts` YALNIZ BU DOSYADAN import ediliyor.
 *
 * Kural bir üslup tercihi değil: kütüphaneyi değiştirmek (ya da bir gün elle
 * yazılmış SVG'ye dönmek) tek bir dosyayı değiştirmek olmalı. Sayfalar veri ve
 * eksen tanımı veriyor, çizim biçiminden habersizler.
 *
 * ⚠️ GRAFİK İKİNCİL. Her raporda tablo HER ZAMAN render ediliyor ve gerçeğin
 * kaynağı o; buradaki SVG `aria-hidden`. Bir SVG'yi ekran okuyucuya anlamlı
 * kılmaya çalışmak yerine, aynı veriyi zaten erişilebilir bir tabloda vermek
 * hem daha dürüst hem daha az kod.
 */

export interface ChartPoint {
  label: string;
  value: number;
  /** İkinci seri (ciroda tahsilat, doluluğun yanında müsaitlik). */
  secondary?: number | undefined;
}

interface Props {
  kind: 'bar' | 'line';
  points: readonly ChartPoint[];
  /** Tooltip'te ve eksende değeri biçimlendirir. */
  format: (value: number) => string;
  height?: number | undefined;
}

/** Panel paleti SABİT — kiracı temasının kontrastı buraya karışmıyor. */
/*
 * Renkler tokendan geliyor, sabitten değil.
 *
 * recharts SVG özniteliği bekliyor ve Tailwind sınıfı alamıyor; `var(--...)`
 * ise SVG `fill`/`stroke` içinde geçerli. Böylece grafik paletle birlikte
 * değişiyor — önceki sabitler (#2f6f5e / #c3d9d1) panelin markasıyla zaten
 * uyuşmuyordu.
 */
const PRIMARY = 'var(--chart-1)';
const SECONDARY = 'var(--chart-2)';
const GRID = 'var(--border)';

export function ReportChart({ kind, points, format, height = 240 }: Props): ReactNode {
  // Tek noktalı bir çizgi grafiği görünmez bir nokta çizer; o durumda bar daha
  // dürüst. Kullanıcı "grafik bozuk" demesin diye biçimi veri belirliyor.
  const effectiveKind = kind === 'line' && points.length < 2 ? 'bar' : kind;

  if (points.length === 0) return null;

  return (
    <div aria-hidden="true" className="mb-4 rounded-md border border-border bg-card p-3">
      <ResponsiveContainer width="100%" height={height}>
        {effectiveKind === 'bar' ? (
          <BarChart data={[...points]} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={format} width={72} />
            <Tooltip formatter={(value) => format(Number(value))} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {points.map((point) => (
                <Cell key={point.label} fill={PRIMARY} />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <LineChart data={[...points]} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={format} width={72} />
            <Tooltip formatter={(value) => format(Number(value))} />
            {points.some((point) => point.secondary !== undefined) ? (
              <Line
                type="monotone"
                dataKey="secondary"
                stroke={SECONDARY}
                strokeWidth={2}
                dot={false}
              />
            ) : null}
            <Line type="monotone" dataKey="value" stroke={PRIMARY} strokeWidth={2} dot={false} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
