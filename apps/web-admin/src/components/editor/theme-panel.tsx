'use client';

import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { FontFamily, Radius, ThemeInput } from '@klinara/shared';
import { THEME_FONT_OPTIONS, THEME_RADIUS_OPTIONS } from '@/lib/editor/block-schema';
import { AssetPicker } from './asset-picker';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';

/**
 * Tema paneli.
 *
 * Yazı tipi ve köşe yarıçapı BEYAZ LİSTEDEN geliyor (`@klinara/shared`),
 * serbest metin değil: serbest bir `font-family` değeri, kiracının kendi
 * sayfasına enjekte ettiği bir CSS parçası olurdu. Renk hem seçiciyle hem hex
 * metniyle girilebiliyor (marka rengini bilen kullanıcı kopyalayıp yapıştırır);
 * metin yalnız GEÇERLİ bir hex olduğunda temaya yazılıyor, yani sunucunun
 * `@IsHexColor`ı kullanıcıya hiç hata göstermiyor.
 */

const DEFAULTS = { primaryColor: '#0F766E', backgroundColor: '#FFFFFF', textColor: '#1C1917' } as const;

/** Hazır paletler — okunabilir kontrastla seçilmiş başlangıç noktaları. */
const PRESETS: readonly { name: string; primaryColor: string; backgroundColor: string; textColor: string }[] = [
  { name: 'Okyanus', primaryColor: '#0F766E', backgroundColor: '#FAF9F7', textColor: '#1C1917' },
  { name: 'Adaçayı', primaryColor: '#5F7A5B', backgroundColor: '#F7F6F1', textColor: '#23261F' },
  { name: 'Pudra', primaryColor: '#B4536A', backgroundColor: '#FDF7F7', textColor: '#2B1D21' },
  { name: 'Lavanta', primaryColor: '#6D5BA8', backgroundColor: '#F8F7FC', textColor: '#1F1B2E' },
  { name: 'Gece', primaryColor: '#C8A96A', backgroundColor: '#15171C', textColor: '#F3F1EC' },
];

const FONT_LABEL: Record<FontFamily, { name: string; stack: string }> = {
  system: { name: 'Sistem', stack: 'system-ui, sans-serif' },
  inter: { name: 'Inter', stack: 'Inter, system-ui, sans-serif' },
  playfair: { name: 'Playfair', stack: '"Playfair Display", Georgia, serif' },
  'dm-sans': { name: 'DM Sans', stack: '"DM Sans", system-ui, sans-serif' },
  lora: { name: 'Lora', stack: 'Lora, Georgia, serif' },
};

const RADIUS_LABEL: Record<Radius, { name: string; css: string }> = {
  none: { name: 'Keskin', css: '0' },
  sm: { name: 'Az', css: '4px' },
  md: { name: 'Orta', css: '8px' },
  lg: { name: 'Yuvarlak', css: '14px' },
  full: { name: 'Hap', css: '999px' },
};

export function ThemePanel({
  theme,
  readOnly,
  onChange,
}: {
  theme: ThemeInput;
  readOnly: boolean;
  onChange: (theme: ThemeInput) => void;
}): ReactNode {
  const primary = theme.primaryColor ?? DEFAULTS.primaryColor;
  const background = theme.backgroundColor ?? DEFAULTS.backgroundColor;
  const text = theme.textColor ?? DEFAULTS.textColor;
  const font = theme.fontFamily ?? 'system';
  const radius = theme.radius ?? 'md';

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('editor.presets')}
        </h3>
        <div className="grid grid-cols-5 gap-1.5">
          {PRESETS.map((preset) => {
            const active =
              same(preset.primaryColor, primary) &&
              same(preset.backgroundColor, background) &&
              same(preset.textColor, text);
            return (
              <button
                key={preset.name}
                type="button"
                disabled={readOnly}
                title={preset.name}
                aria-label={preset.name}
                aria-pressed={active}
                onClick={() =>
                  onChange({
                    ...theme,
                    primaryColor: preset.primaryColor,
                    backgroundColor: preset.backgroundColor,
                    textColor: preset.textColor,
                  })
                }
                className={cn(
                  'relative flex aspect-square items-end justify-center overflow-hidden rounded-lg border-2 p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                  active ? 'border-primary' : 'border-border hover:border-primary/40',
                )}
                style={{ backgroundColor: preset.backgroundColor }}
              >
                <span className="h-2.5 w-full rounded-full" style={{ backgroundColor: preset.primaryColor }} />
                {active ? (
                  <Check
                    aria-hidden="true"
                    className="absolute top-1 right-1 size-3"
                    style={{ color: preset.textColor }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <ColorField
          label={t('editor.primaryColor')}
          value={primary}
          readOnly={readOnly}
          onChange={(primaryColor) => onChange({ ...theme, primaryColor })}
        />
        <ColorField
          label={t('editor.backgroundColor')}
          value={background}
          readOnly={readOnly}
          onChange={(backgroundColor) => onChange({ ...theme, backgroundColor })}
        />
        <ColorField
          label={t('editor.textColor')}
          value={text}
          readOnly={readOnly}
          onChange={(textColor) => onChange({ ...theme, textColor })}
        />
      </section>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-medium text-foreground">{t('editor.fontFamily')}</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {THEME_FONT_OPTIONS.map((option) => (
            <ChoiceCard
              key={option}
              pressed={font === option}
              disabled={readOnly}
              onClick={() => onChange({ ...theme, fontFamily: option })}
            >
              <span className="text-lg leading-none" style={{ fontFamily: FONT_LABEL[option].stack }}>
                Aa
              </span>
              <span className="text-xs text-muted-foreground">{FONT_LABEL[option].name}</span>
            </ChoiceCard>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-medium text-foreground">{t('editor.radius')}</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {THEME_RADIUS_OPTIONS.map((option) => (
            <ChoiceCard
              key={option}
              pressed={radius === option}
              disabled={readOnly}
              onClick={() => onChange({ ...theme, radius: option })}
              compact
            >
              <span
                aria-hidden="true"
                className="h-4 w-7 border-2 border-foreground/70"
                style={{ borderRadius: RADIUS_LABEL[option].css }}
              />
              <span className="text-[10px] text-muted-foreground">{RADIUS_LABEL[option].name}</span>
            </ChoiceCard>
          ))}
        </div>
      </fieldset>

      <AssetPicker
        label={t('editor.logo')}
        assetId={theme.logoAssetId ?? null}
        purpose="booking_logo"
        readOnly={readOnly}
        onChange={(logoAssetId) => onChange(withLogo(theme, logoAssetId))}
      />
    </div>
  );
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function ChoiceCard({
  pressed,
  disabled,
  compact = false,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled: boolean;
  compact?: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-lg border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
        compact ? 'px-1 py-2' : 'px-2 py-2.5',
        pressed ? 'border-primary bg-accent' : 'border-border hover:border-primary/40',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Logoyu ayarla ya da KALDIR.
 *
 * `exactOptionalPropertyTypes` açık olduğu için `logoAssetId: undefined`
 * ATAMAK geçerli değil; anahtarın tamamen ÇIKMASI gerekiyor. Aksi hâlde
 * sunucuya, "değiştirme" ile "kaldır" arasında ayrım yapamayan bir alan giderdi.
 */
function withLogo(theme: ThemeInput, logoAssetId: string | null): ThemeInput {
  if (logoAssetId === null) {
    const next: ThemeInput = {};
    for (const [key, value] of Object.entries(theme)) {
      if (key !== 'logoAssetId') (next as Record<string, unknown>)[key] = value;
    }
    return next;
  }
  return { ...theme, logoAssetId };
}

const HEX = /^#[0-9a-f]{6}$/i;

function ColorField({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}): ReactNode {
  // Metin kutusu yazma sırasında geçersiz ara değerler taşıyabiliyor (#0F7…);
  // temaya yalnız geçerli hex yazılıyor, dışarıdan gelen değişiklik (hazır
  // palet) kutuyu da güncelliyor.
  const [draft, setDraft] = useState(value.toUpperCase());
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    // Render sırasında durum ayarlama: efekt turu olmadan eşitleniyor.
    setSeen(value);
    setDraft(value.toUpperCase());
  }
  const invalid = !HEX.test(draft);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          value={draft}
          readOnly={readOnly}
          aria-label={`${label} (hex)`}
          aria-invalid={invalid}
          title={invalid ? t('editor.hexInvalid') : undefined}
          maxLength={7}
          onChange={(event) => {
            const next = event.target.value.startsWith('#') ? event.target.value : `#${event.target.value}`;
            setDraft(next.toUpperCase());
            if (HEX.test(next)) onChange(next.toUpperCase());
          }}
          className={cn(
            'h-8 w-[5.5rem] rounded-md border bg-background px-2 font-mono text-xs uppercase',
            invalid ? 'border-destructive' : 'border-border',
          )}
        />
        <input
          type="color"
          value={HEX.test(value) ? value : '#000000'}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          aria-label={label}
          className="h-8 w-9 cursor-pointer rounded-md border border-border bg-background p-0.5"
        />
      </span>
    </div>
  );
}
