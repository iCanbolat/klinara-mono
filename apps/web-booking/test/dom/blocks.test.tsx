import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PublicSitePayload } from '@klinara/shared';
import { renderableBlocks } from '../../src/components/blocks/registry';
import { Markdown } from '../../src/components/blocks/markdown';
import { ServiceList } from '../../src/components/blocks/blocks';

describe('blok süzgeci', () => {
  it('sözlükte olmayan blok türünü SESSİZCE atlıyor', () => {
    // API blok sözlüğünü büyüttüğünde eski istemci beyaz ekran vermemeli;
    // bu, 11.1'in kabul kriteri.
    const blocks = renderableBlocks([
      { type: 'hero', title: 'A' },
      { type: 'video', url: 'x' },
      { type: 'richText', body: 'B' },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['hero', 'richText']);
  });

  it('gizli bloğu atlıyor', () => {
    expect(renderableBlocks([{ type: 'hero', title: 'A', visible: false }])).toHaveLength(0);
  });

  it('bozuk girdide çökmüyor', () => {
    expect(renderableBlocks(null)).toEqual([]);
    expect(renderableBlocks([null, 'x', 42, {}])).toEqual([]);
  });
});

describe('markdown renderer', () => {
  it('başlık, liste ve satır içi biçimlendirmeyi çiziyor', () => {
    const { container } = render(
      <Markdown source={'# Başlık\n\nBir **kalın** ve *italik*.\n\n- bir\n- iki'} />,
    );
    expect(container.querySelector('h2')?.textContent).toBe('Başlık');
    expect(container.querySelector('strong')?.textContent).toBe('kalın');
    expect(container.querySelector('em')?.textContent).toBe('italik');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('HTML girdisini METİN olarak basıyor, ayrıştırmıyor', () => {
    // API `richText` alanında HTML'i bilerek reddediyor; istemci o kararı
    // sessizce geri almamalı.
    const { container } = render(<Markdown source={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('güvenli olmayan bağlantı şemasını bağlantı YAPMIYOR', () => {
    const { container } = render(<Markdown source={'[tıkla](javascript:alert(1))'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('tıkla');
  });

  it('https bağlantısını rel korumasıyla çiziyor', () => {
    const { container } = render(<Markdown source={'[site](https://ornek.com)'} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://ornek.com');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });
});

describe('hizmet listesi — showPrices', () => {
  const site = (showPrices: boolean): PublicSitePayload =>
    ({
      slug: 'demo',
      name: 'Demo',
      timezone: 'Europe/Istanbul',
      currency: 'TRY',
      locales: ['tr'],
      defaultBranchId: null,
      canonicalUrl: '',
      branches: [],
      theme: {},
      sections: [],
      seo: {},
      settings: {
        minLeadMinutes: 0,
        maxAdvanceDays: 180,
        cancelWindowHours: 24,
        holdTtlMinutes: 10,
        showStaffSelection: true,
        showPrices,
        allowReschedule: true,
        requireOtp: true,
        otpChannel: 'sms',
        requiredConsents: [],
      },
      revision: { number: 1, contentHash: 'x' },
    });

  const categories = [
    {
      id: 'c1',
      name: 'Cilt',
      services: [
        {
          id: 's1',
          name: 'Lazer',
          description: null,
          durationMinutes: 30,
          priceMinor: 125_000,
          currency: 'TRY',
        },
      ],
    },
  ];

  it('showPrices açıkken fiyatı gösteriyor', () => {
    render(
      <ServiceList
        block={{ type: 'serviceList' }}
        ctx={{ site: site(true), categories, isFirst: false }}
      />,
    );
    expect(screen.getByText(/1\.250,00/)).toBeInTheDocument();
  });

  it('showPrices kapalıyken fiyat DÜĞÜMÜ hiç yok', () => {
    // "0 TL" yazmamak yetmez; DOM'da fiyat olmamalı.
    const { container } = render(
      <ServiceList
        block={{ type: 'serviceList' }}
        ctx={{ site: site(false), categories, isFirst: false }}
      />,
    );
    expect(container.textContent).not.toContain('1.250');
    expect(container.textContent).not.toContain('TRY');
    expect(container.textContent).not.toContain('₺');
  });
});
