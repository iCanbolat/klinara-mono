import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../src/components/ui/button';

/*
 * `loading` sözleşmesi shadcn'in `Button`ında YOK; bu panelde bilerek korunuyor
 * ve bir yükseltmede sessizce kaybolmaması için sınanıyor.
 */
describe('Button', () => {
  it('yüklenirken çocukları DOM\'da tutuyor — düğme genişliği zıplamıyor', () => {
    render(<Button loading>Kaydet</Button>);
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeInTheDocument();
  });

  it('yüklenirken aria-busy veriyor ve tıklamayı yutuyor', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Kaydet
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Kaydet' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('yüklenmiyorken normal çalışıyor', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Kaydet</Button>);
    const button = screen.getByRole('button', { name: 'Kaydet' });
    expect(button).toHaveAttribute('aria-busy', 'false');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
