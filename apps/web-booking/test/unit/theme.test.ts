import { describe, it, expect } from 'vitest';
import { THEME_DEFAULTS, themeStyleSheet, themeVariables } from '../../src/lib/theme';

describe('tema → CSS custom property', () => {
  it('geçerli değerleri geçiriyor', () => {
    const vars = themeVariables({
      primaryColor: '#123456',
      backgroundColor: '#ABCDEF',
      textColor: '#000',
      fontFamily: 'playfair',
      radius: 'full',
    });
    expect(vars['--brand-primary']).toBe('#123456');
    expect(vars['--brand-bg']).toBe('#ABCDEF');
    expect(vars['--brand-text']).toBe('#000');
    expect(vars['--brand-radius']).toBe('9999px');
    expect(vars['--brand-font']).toContain('Georgia');
  });

  it('beyaz liste dışındaki yazı tipi ve yarıçap varsayılana düşüyor', () => {
    const vars = themeVariables({
      fontFamily: 'comic-sans' as never,
      radius: 'enormous' as never,
    });
    expect(vars['--brand-font']).toContain('system-ui');
    expect(vars['--brand-radius']).toBe('10px');
  });

  it('renk alanına gelen CSS enjeksiyonunu reddediyor', () => {
    // Sunucuda `@IsHexColor` var; bu ikinci savunma katmanı. Geçseydi
    // `--brand-primary` değeri stil bloğundan çıkıp kural yazabilirdi.
    const vars = themeVariables({ primaryColor: 'red;} body{display:none' });
    expect(vars['--brand-primary']).toBe(THEME_DEFAULTS.primaryColor);
    expect(themeStyleSheet({ primaryColor: 'red;} body{display:none' })).not.toContain('display');
  });

  it('tema hiç yoksa tam bir stil bloğu üretiyor', () => {
    const css = themeStyleSheet(undefined);
    expect(css.startsWith(':root{')).toBe(true);
    for (const key of ['--brand-primary', '--brand-bg', '--brand-text', '--brand-radius', '--brand-font']) {
      expect(css).toContain(key);
    }
  });
});
