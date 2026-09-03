import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicBookingSettings, PublicCategory, PublicSitePayload } from '@klinara/shared';
import { stepsFor } from '../../src/components/booking/machine';
import { buildSelection } from '../../src/components/booking/selection';
import { initialState } from '../../src/components/booking/machine';
import { Stepper } from '../../src/components/booking/stepper';
import { SummaryRows } from '../../src/components/booking/summary-panel';
import { BranchStep } from '../../src/components/booking/steps/branch-step';
import { ServiceStep } from '../../src/components/booking/steps/service-step';
import { StaffStep } from '../../src/components/booking/steps/staff-step';
import { ConsentStep } from '../../src/components/booking/steps/consent-step';
import { OtpInput } from '../../src/components/ui/otp-input';
import { toE164, toNationalDigits } from '../../src/components/ui/phone-input';

const settings = (overrides: Partial<PublicBookingSettings> = {}): PublicBookingSettings => ({
  minLeadMinutes: 0,
  maxAdvanceDays: 180,
  cancelWindowHours: 24,
  holdTtlMinutes: 10,
  showStaffSelection: true,
  showPrices: true,
  allowReschedule: true,
  requireOtp: true,
  otpChannel: 'sms',
  requiredConsents: [],
  ...overrides,
});

const site = (overrides: Partial<PublicBookingSettings> = {}): PublicSitePayload => ({
  slug: 'demo',
  name: 'Demo Klinik',
  timezone: 'Europe/Istanbul',
  currency: 'TRY',
  locales: ['tr'],
  defaultBranchId: 'b1',
  canonicalUrl: '',
  branches: [
    { id: 'b1', name: 'Kadıköy', timezone: 'Europe/Istanbul', phone: null, address: 'Moda' },
    { id: 'b2', name: 'Beşiktaş', timezone: 'Europe/Istanbul', phone: null, address: null },
  ],
  theme: {},
  sections: [],
  seo: {},
  settings: settings(overrides),
  revision: { number: 1, contentHash: 'x' },
});

const categories: PublicCategory[] = [
  {
    id: 'c1',
    name: 'Cilt',
    services: [
      {
        id: 's1',
        name: 'Lazer',
        description: 'Tek seans',
        durationMinutes: 30,
        priceMinor: 125_000,
        currency: 'TRY',
      },
      {
        id: 's2',
        name: 'Peeling',
        description: null,
        durationMinutes: 45,
        priceMinor: 75_000,
        currency: 'TRY',
      },
    ],
  },
];

describe('stepper', () => {
  it('showStaffSelection kapalıyken uygulayıcı adımı HİÇ yok', () => {
    const steps = stepsFor(settings({ showStaffSelection: false }));
    render(<Stepper steps={steps} current="service" onGoto={vi.fn()} />);
    expect(screen.queryByText('Uygulayıcı')).not.toBeInTheDocument();
    // Mobil sayaç da doğru saymalı: branch, service, datetime, identity, confirm.
    expect(screen.getByText('Adım 2 / 5')).toBeInTheDocument();
  });

  it('tamamlanmış adım tıklanabilir, ileri adım DEĞİL', async () => {
    const onGoto = vi.fn();
    const steps = stepsFor(settings({ showStaffSelection: false, requireOtp: false }));
    render(<Stepper steps={steps} current="datetime" onGoto={onGoto} />);

    // İleri sıçramak `canAdvance` kuralını atlardı.
    expect(screen.getByRole('button', { name: /Özet/ })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Şube/ }));
    expect(onGoto).toHaveBeenCalledWith('branch');
  });
});

describe('seçim kartları — grup semantiği', () => {
  it('şubeler radio grubu, seçim aria-checked ile duyuruluyor', async () => {
    const onChange = vi.fn();
    render(<BranchStep branches={site().branches} value="b1" onChange={onChange} />);

    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(options[1]!);
    expect(onChange).toHaveBeenCalledWith('b2');
  });

  it('hizmetler CHECKBOX: çoklu seçim olduğu rolden anlaşılıyor', async () => {
    const onToggle = vi.fn();
    render(
      <ServiceStep
        categories={categories}
        selectedIds={['s1']}
        onToggle={onToggle}
        showPrices
        currency="TRY"
        totalMinutes={30}
        totalMinor={125_000}
      />,
    );

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toHaveAttribute('aria-checked', 'true');
    expect(boxes[1]).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(boxes[1]!);
    expect(onToggle).toHaveBeenCalledWith('s2');
  });

  it('"Fark etmez" geri seçilebilir bir SEÇENEK', async () => {
    const onChange = vi.fn();
    render(
      <StaffStep
        staff={[{ staffRef: 'r1', name: 'Ayşe Yılmaz', title: 'Uzman' }]}
        value="r1"
        onChange={onChange}
        loading={false}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /Fark etmez/ }));
    // Sentinel dışarı sızmıyor: çağıran `null` görüyor.
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('fotoğraf yokken baş harf monogramı çiziliyor', () => {
    render(
      <StaffStep
        staff={[{ staffRef: 'r1', name: 'Ayşe Yılmaz', title: null }]}
        value={null}
        onChange={vi.fn()}
        loading={false}
      />,
    );
    expect(screen.getByText('AY')).toBeInTheDocument();
  });
});

describe('showPrices kapalı', () => {
  it('hizmet kartında fiyat DÜĞÜMÜ yok', () => {
    const { container } = render(
      <ServiceStep
        categories={categories}
        selectedIds={[]}
        onToggle={vi.fn()}
        showPrices={false}
        currency="TRY"
        totalMinutes={0}
        totalMinor={null}
      />,
    );
    // "0 TL" yazmamak yetmez; DOM'da fiyat olmamalı.
    expect(container.textContent).not.toContain('1.250');
    expect(container.textContent).not.toContain('₺');
    expect(container.textContent).toContain('30 dk');
  });

  it('özet panelinde de fiyat yok, süre var', () => {
    const state = { ...initialState(), branchId: 'b1', serviceIds: ['s1', 's2'] };
    const selection = buildSelection(site({ showPrices: false }), categories, state, null);
    expect(selection.totalMinor).toBeNull();

    const { container } = render(
      <SummaryRows selection={selection} steps={stepsFor(settings())} onEdit={vi.fn()} />,
    );
    expect(container.textContent).not.toContain('₺');
    expect(container.textContent).toContain('75 dk');
    expect(container.textContent).toContain('Lazer, Peeling');
  });
});

describe('özet paneli', () => {
  it('seçilmemiş satır "Değiştir" göstermiyor', () => {
    const selection = buildSelection(site(), categories, initialState(), null);
    render(<SummaryRows selection={selection} steps={stepsFor(settings())} onEdit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Değiştir' })).not.toBeInTheDocument();
  });

  it('dolu satırdan ilgili adıma dönülüyor', async () => {
    const onEdit = vi.fn();
    const state = { ...initialState(), branchId: 'b1' };
    const selection = buildSelection(site(), categories, state, null);
    render(<SummaryRows selection={selection} steps={stepsFor(settings())} onEdit={onEdit} />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Değiştir' })[0]!);
    expect(onEdit).toHaveBeenCalledWith('branch');
  });
});

describe('onam adımı', () => {
  const consents = [
    { kind: 'kvkk', text: 'Aydınlatma metnini okudum.', required: true, textSha256: 'a' },
    { kind: 'sms', text: 'SMS almak istiyorum.', required: false, textSha256: 'b' },
  ];

  it('sunucu CONSENT_REQUIRED dediğinde eksik ZORUNLU onam işaretleniyor', () => {
    render(
      <ConsentStep consents={consents} values={{ sms: true }} onToggle={vi.fn()} highlightMissing />,
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).toHaveAttribute('aria-invalid', 'true');
    // İsteğe bağlı onam hiçbir zaman hata göstermez.
    expect(boxes[1]).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('doğrulama kodu girişi', () => {
  it('otomatik dolgunun tek kutuya yazdığı 6 haneyi DAĞITIYOR', () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);
    // `autocomplete="one-time-code"` dolgusu ilk kutuya tüm kodu TEK SEFERDE
    // yazar; `maxLength` olmadığı için tarayıcı kırpmıyor, bileşen dağıtıyor.
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: '123456' } });
    expect(onChange).toHaveBeenCalledWith('123456');
  });

  it('harfleri yok sayıyor', () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'a' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('altı kutu ve her biri etiketli', () => {
    render(<OtpInput value="12" onChange={vi.fn()} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
    expect(screen.getByLabelText('1. hane')).toHaveValue('1');
    expect(screen.getByLabelText('3. hane')).toHaveValue('');
  });
});

describe('telefon normalizasyonu', () => {
  it('kullanıcının yazabileceği her biçimden aynı numarayı çıkarıyor', () => {
    for (const raw of ['0532 123 45 67', '532 123 45 67', '+90 532 123 45 67', '905321234567']) {
      expect(toNationalDigits(raw)).toBe('5321234567');
    }
  });

  it('eksik numarada E.164 üretmiyor — çağıran gönderemesin', () => {
    expect(toE164('53212345')).toBe('');
    expect(toE164('5321234567')).toBe('+905321234567');
  });
});
