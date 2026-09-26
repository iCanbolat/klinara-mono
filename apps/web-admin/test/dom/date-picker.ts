import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * `DatePicker` artık yerel `<input type="date">` değil; tarihe yazılamıyor,
 * takvimden SEÇİLİYOR. Yardımcı gerçek kullanıcı yolunu yürüyor: tetikleyiciyi
 * aç, hedef aya ok düğmeleriyle git, günü tıkla.
 *
 * Gün düğmeleri `data-day` (tr-TR `GG.AA.YYYY`) taşıyor; dış günler
 * (`.rdp-outside`) atlanıyor — önceki/sonraki ayın aynı sayılı günü değil.
 */
export async function pickDate(user: UserEvent, trigger: HTMLElement, key: string): Promise<void> {
  const [year, month, day] = key.split('-');
  const target = `${day ?? ''}.${month ?? ''}.${year ?? ''}`;
  const targetMonth = Number(year) * 12 + Number(month);

  await user.click(trigger);
  const popover = await screen.findByRole('grid');
  const root = popover.closest('[data-slot="calendar"]') as HTMLElement;

  for (let step = 0; step < 60; step += 1) {
    const button = root.querySelector<HTMLElement>(
      `td:not(.rdp-outside) button[data-day="${target}"]`,
    );
    if (button !== null) {
      await user.click(button);
      return;
    }
    // Görünen ay: dış olmayan ilk günün `data-day`inden.
    const shown = root.querySelector<HTMLElement>('td:not(.rdp-outside) button[data-day]');
    const [, shownMonth, shownYear] = (shown?.dataset['day'] ?? '').split('.');
    const current = Number(shownYear) * 12 + Number(shownMonth);
    const name = targetMonth > current ? 'Sonraki aya git' : 'Önceki aya git';
    await user.click(within(root).getByRole('button', { name }));
  }
  throw new Error(`pickDate: ${key} takvimde bulunamadı`);
}

/** Bugünden `days` gün sonrası, yerel `YYYY-MM-DD`. */
export function dayFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
}
