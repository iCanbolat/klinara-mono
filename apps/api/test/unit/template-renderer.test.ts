import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  templateVariables,
} from '../../src/modules/notifications/template-renderer';
import { AppError } from '../../src/common/errors/app-error';

describe('şablon değişkenleri (Batch 8.1)', () => {
  it('değişkenleri yerine koyar', () => {
    expect(renderTemplate('Sayın {{name}}, saat {{ time }}.', { name: 'Ayşe', time: '14:00' })).toBe(
      'Sayın Ayşe, saat 14:00.',
    );
  });

  it('tanımsız değişkeni SESSİZCE boş bırakmaz', () => {
    // "Sayın , randevunuz  saatinde" gibi bir mesaj müşteriye gittiğinde geri
    // alınamaz; hata şablonu yazana, yazdığı anda dönmeli.
    try {
      renderTemplate('Sayın {{name}}, saat {{time}}.', { name: 'Ayşe' });
      throw new Error('hata bekleniyordu');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('TEMPLATE_INVALID');
      expect((error as AppError).message).toContain('time');
    }
  });

  it('kullanılan değişkenleri tekilleştirerek listeler', () => {
    expect(templateVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });
});
