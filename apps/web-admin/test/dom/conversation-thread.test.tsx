import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConversationDetail, ConversationTemplateOption } from '@klinara/shared';

const get = vi.fn();
const post = vi.fn();

class SessionExpiredError extends Error {}
class ApiProblemError extends Error {
  constructor(
    readonly problem: { code: string; status: number },
    readonly retryAfterSeconds: number | null,
  ) {
    super(problem.code);
  }
}

vi.mock('@/lib/api/client', () => ({ api: { get, post }, ApiProblemError, SessionExpiredError }));

const { ConversationThread } = await import('../../src/components/messages/conversation-thread');

const detail = (windowOpen: boolean): ConversationDetail => ({
  conversation: {
    id: 'c1',
    phone: '+905321234567',
    customer: { id: 'u1', fullName: 'Ayşe Yılmaz' },
    status: 'open',
    lastMessageAt: '2026-09-20T10:00:00+03:00',
    lastMessagePreview: 'Merhaba',
    lastMessageDirection: 'in',
    unread: false,
    windowOpen,
    windowExpiresAt: windowOpen ? new Date(Date.now() + 3_600_000).toISOString() : null,
  },
  messages: [
    {
      id: 'm1',
      direction: 'in',
      type: 'text',
      body: 'Merhaba',
      createdAt: '2026-09-20T10:00:00+03:00',
      status: null,
      event: null,
      sentByName: null,
      errorDetail: null,
      appointmentId: null,
    },
  ],
});

const OPTIONS: ConversationTemplateOption[] = [
  {
    name: 'klinara_gelmedi_takip',
    language: 'tr',
    category: 'UTILITY',
    bodyText: 'Merhaba {{1}}, {{2}} olarak size ulaşmak istedik.',
    bodyVariableCount: 2,
    variableNames: ['customerName', 'branchName'],
    suggestedParameters: ['Ayşe Yılmaz', 'Kadıköy'],
  },
  {
    name: 'paket_bilgi',
    language: 'tr',
    category: 'UTILITY',
    bodyText: 'Paket bilgisi: {{1}}',
    bodyVariableCount: 1,
    variableNames: [null],
    suggestedParameters: [''],
  },
];

function renderThread(windowOpen: boolean) {
  const onSendTemplate = vi.fn().mockResolvedValue({
    ...detail(false).messages[0],
    id: 'm2',
    direction: 'out',
    type: 'template',
    status: 'sent',
  });
  render(
    <ConversationThread
      detail={detail(windowOpen)}
      error={null}
      sending={false}
      onSend={vi.fn()}
      onSendTemplate={onSendTemplate}
      onBack={vi.fn()}
      onTogglePanel={vi.fn()}
      onConversationChange={vi.fn()}
      onOpenAppointment={vi.fn()}
    />,
  );
  return { onSendTemplate };
}

describe('sohbet: pencere kapalıyken şablon', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue(OPTIONS);
  });

  it('pencere açıkken yazma alanı var, şablon düğmesi yok', () => {
    renderThread(true);
    expect(screen.getByLabelText('Mesaj')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Şablon gönder' })).not.toBeInTheDocument();
  });

  it('pencere kapalıyken yazma alanı yok, şablon düğmesi var', () => {
    renderThread(false);
    expect(screen.queryByLabelText('Mesaj')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Şablon gönder' })).toBeInTheDocument();
  });

  it('diyalog önerilerle dolar; önizleme değişkenlerle güncellenir; gönderim doğru gövdeyi taşır', async () => {
    const user = userEvent.setup();
    const { onSendTemplate } = renderThread(false);

    await user.click(screen.getByRole('button', { name: 'Şablon gönder' }));
    expect(get).toHaveBeenCalledWith('conversations/c1/templates', expect.anything());

    const preview = await screen.findByTestId('template-preview');
    expect(preview).toHaveTextContent('Merhaba Ayşe Yılmaz, Kadıköy olarak size ulaşmak istedik.');

    const branch = screen.getByLabelText('Şube / klinik adı');
    await user.clear(branch);
    await user.type(branch, 'Moda');
    expect(preview).toHaveTextContent('Merhaba Ayşe Yılmaz, Moda olarak');

    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    await waitFor(() =>
      expect(onSendTemplate).toHaveBeenCalledWith({
        templateName: 'klinara_gelmedi_takip',
        language: 'tr',
        parameters: ['Ayşe Yılmaz', 'Moda'],
      }),
    );
  });

  it('boş değişkenle gönderilmez', async () => {
    const user = userEvent.setup();
    const { onSendTemplate } = renderThread(false);

    await user.click(screen.getByRole('button', { name: 'Şablon gönder' }));
    await screen.findByTestId('template-preview');
    await user.selectOptions(screen.getByLabelText('Şablon'), 'paket_bilgi|tr');
    expect(screen.getByTestId('template-preview')).toHaveTextContent('Paket bilgisi: {{1}}');

    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(await screen.findByText('Tüm değişkenleri doldurun.')).toBeInTheDocument();
    expect(onSendTemplate).not.toHaveBeenCalled();
  });

  it('onaylı şablon yoksa yönlendirme metni gösterilir', async () => {
    get.mockResolvedValue([]);
    const user = userEvent.setup();
    renderThread(false);
    await user.click(screen.getByRole('button', { name: 'Şablon gönder' }));
    expect(await screen.findByText(/Gönderilebilecek onaylı şablon yok/)).toBeInTheDocument();
  });
});
