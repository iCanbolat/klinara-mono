import { FONT_FAMILIES, RADII, type Theme } from '@klinara/shared';

/**
 * Tema → CSS custom property.
 *
 * Renkler bir stil dosyasına DEĞİL, `:root` üzerindeki değişkenlere yazılıyor:
 * Tailwind sınıfları bu değişkenleri okuduğu için kiracı rengini değiştirmek
 * yeniden derleme gerektirmiyor ve her blok aynı paletten besleniyor.
 *
 * ⚠️ Değerler kiracıdan geliyor. `fontFamily` ve `radius` sunucuda beyaz
 * listeli ama renkler serbest metin olarak gelebilir (`@IsHexColor` var, yine de
 * savunma katmanı ucuz): geçersiz bir değer varsayılana düşer, sayfaya
 * enjekte edilmez.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const DEFAULTS = {
  primaryColor: '#0f766e',
  backgroundColor: '#faf9f7',
  textColor: '#1c1917',
} as const;

const RADIUS_VALUES: Record<string, string> = {
  none: '0px',
  sm: '4px',
  md: '10px',
  lg: '18px',
  full: '9999px',
};

const FONT_STACKS: Record<string, string> = {
  system:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  inter: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  playfair: 'var(--font-playfair), Georgia, "Times New Roman", serif',
  'dm-sans': 'var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif',
  lora: 'var(--font-lora), Georgia, "Times New Roman", serif',
};

function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value : fallback;
}

function fromWhitelist(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

export interface ThemeVariables {
  '--brand-primary': string;
  '--brand-bg': string;
  '--brand-text': string;
  '--brand-radius': string;
  '--brand-font': string;
}

export function themeVariables(theme: Theme | undefined): ThemeVariables {
  const font = fromWhitelist(theme?.fontFamily, FONT_FAMILIES, 'system');
  const radius = fromWhitelist(theme?.radius, RADII, 'md');
  return {
    '--brand-primary': hex(theme?.primaryColor, DEFAULTS.primaryColor),
    '--brand-bg': hex(theme?.backgroundColor, DEFAULTS.backgroundColor),
    '--brand-text': hex(theme?.textColor, DEFAULTS.textColor),
    '--brand-radius': RADIUS_VALUES[radius] ?? RADIUS_VALUES['md'] ?? '10px',
    '--brand-font': FONT_STACKS[font] ?? FONT_STACKS['system'] ?? 'sans-serif',
  };
}

/** `<style>` içine gömülecek `:root` bloğu. */
export function themeStyleSheet(theme: Theme | undefined): string {
  const vars = themeVariables(theme);
  const body = Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
  return `:root{${body}}`;
}

export { FONT_STACKS, RADIUS_VALUES, DEFAULTS as THEME_DEFAULTS };
