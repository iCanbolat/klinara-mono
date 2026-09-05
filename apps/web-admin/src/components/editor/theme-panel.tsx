'use client';

import type { ReactNode } from 'react';
import type { FontFamily, Radius, ThemeInput } from '@klinara/shared';
import { THEME_FONT_OPTIONS, THEME_RADIUS_OPTIONS } from '@/lib/editor/block-schema';
import { AssetPicker } from './asset-picker';
import { FieldSelect } from '@/components/ui/field';
import { t } from '@/i18n/tr';

/**
 * Tema paneli.
 *
 * Yazı tipi ve köşe yarıçapı BEYAZ LİSTEDEN geliyor (`@klinara/shared`),
 * serbest metin değil: serbest bir `font-family` değeri, kiracının kendi
 * sayfasına enjekte ettiği bir CSS parçası olurdu. Renkler `type="color"` ile
 * alınıyor, yani her zaman geçerli hex — sunucunun `@IsHexColor`ı bir daha
 * doğruluyor ama kullanıcı hiç hata görmüyor.
 */
export function ThemePanel({
  theme,
  readOnly,
  onChange,
}: {
  theme: ThemeInput;
  readOnly: boolean;
  onChange: (theme: ThemeInput) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <ColorField
        label={t('editor.primaryColor')}
        value={theme.primaryColor ?? '#0F766E'}
        readOnly={readOnly}
        onChange={(primaryColor) => onChange({ ...theme, primaryColor })}
      />
      <ColorField
        label={t('editor.backgroundColor')}
        value={theme.backgroundColor ?? '#FFFFFF'}
        readOnly={readOnly}
        onChange={(backgroundColor) => onChange({ ...theme, backgroundColor })}
      />
      <ColorField
        label={t('editor.textColor')}
        value={theme.textColor ?? '#1C1917'}
        readOnly={readOnly}
        onChange={(textColor) => onChange({ ...theme, textColor })}
      />

      <FieldSelect
        label={t('editor.fontFamily')}
        value={theme.fontFamily ?? 'system'}
        disabled={readOnly}
        onChange={(event) => onChange({ ...theme, fontFamily: event.target.value as FontFamily })}
      >
        {THEME_FONT_OPTIONS.map((font) => (
          <option key={font} value={font}>
            {font}
          </option>
        ))}
      </FieldSelect>

      <FieldSelect
        label={t('editor.radius')}
        value={theme.radius ?? 'md'}
        disabled={readOnly}
        onChange={(event) => onChange({ ...theme, radius: event.target.value as Radius })}
      >
          {THEME_RADIUS_OPTIONS.map((radius) => (
          <option key={radius} value={radius}>
            {radius}
          </option>
        ))}
      </FieldSelect>

      <AssetPicker
        label={t('editor.logo')}
        assetId={theme.logoAssetId ?? null}
        readOnly={readOnly}
        onChange={(logoAssetId) => onChange(withLogo(theme, logoAssetId))}
      />
    </div>
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
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      {label}
      <span className="flex items-center gap-2">
        {/* Hex metni de gösteriliyor: renk seçici tek başına, seçilen değerin
            ne olduğunu markasını bilen bir kullanıcıya söylemez. */}
        <code className="text-xs text-muted-foreground">{value.toUpperCase()}</code>
        <input
          type="color"
          value={value}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="h-9 w-12 cursor-pointer rounded-lg border border-border"
        />
      </span>
    </label>
  );
}
