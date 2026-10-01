import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS, templateSegments, type NotificationTemplate } from '@klinara/shared';

const get = vi.fn();
const put = vi.fn();
const patch = vi.fn();

class SessionExpiredError extends Error {}
class ApiProblemError extends Error {
  constructor(
    readonly problem: { code: string; status: number; title: string; detail?: string; requestId: string },
    readonly retryAfterSeconds: number | null,
  ) {
    super(problem.code);
  }
}

vi.mock('@/lib/api/client', () => ({
  api: { get, put, patch, post: vi.fn(), delete: vi.fn() },
  ApiProblemError,
  SessionExpiredError,
}));

let branchId: string | null = 'b1';
vi.mock('@/components/session/branch-provider', () => ({
  useBranch: () => ({
    branchId,
    loading: false,
    branches: [],
    canSelectAll: true,
    setBranchId: vi.fn(),
    reload: vi.fn(),
  }),
}));

let permissions: string[] = [];
vi.mock('@/components/session/session-provider', () => ({
  useSession: () => ({ permissions, me: null, loading: false }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { TemplatesPage } = await import('../../src/components/templates/templates-page');

function template(overrides: Partial<NotificationTemplate> = {}): NotificationTemplate {
  const body =
    'Merhaba {{customerName}}, {{serviceName}} randevunuz için bekleriz.\n\nAdres: {{branchAddress}}';
  return {
    id: null,
    event: 'appointment_confirmation',
    channel: 'whatsapp',
    locale: 'tr',
    subject: null,
    body,
    whatsappTemplateName: 'klinara_randevu_olusturuldu_v3',
    whatsappTemplateLanguage: 'tr',
    whatsappVariables: ['customerName', 'serviceName', 'branchAddress'],
    isActive: true,
    isDefault: true,
    variables: ['customerName', 'serviceName', 'branchAddress'],
    segments: templateSegments(body),
    ...overrides,
  };
}

const BRANCH = {
  id: 'b1',
  tenantId: 't1',
  slug: 'kadikoy',
  name: 'Kadıköy Şube',
  timezone: 'Europe/Istanbul',
  phone: null,
  address: 'Bağdat Cad. No:1, Kadıköy',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Kadikoy',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('mesaj şablonları sayfası', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    patch.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    branchId = 'b1';
    permissions = [
      PERMISSIONS.NOTIFICATION_READ,
      PERMISSIONS.NOTIFICATION_MANAGE,
      PERMISSIONS.BRANCH_WRITE,
    ];
    get.mockImplementation((path: string) => {
      if (path === 'notification-templates') return Promise.resolve([template()]);
      if (path === 'branches') return Promise.resolve({ data: [BRANCH] });
      return Promise.resolve({ data: [] });
    });
  });

  it('değişkenleri mavi @Etiket olarak çizer, {{…}} göstermez', async () => {
    const { container } = render(<TemplatesPage />);
    expect(await screen.findByText('Randevu onayı')).toBeInTheDocument();

    const variables = [...container.querySelectorAll('[data-variable]')];
    expect(variables.map((node) => node.textContent)).toEqual([
      '@MüşteriAdı',
      '@HizmetAdı',
      '@KlinikAdresi',
    ]);
    for (const node of variables) expect(node.className).toContain('text-link');
    expect(container.textContent).not.toContain('{{');
  });

  it('anahtarı çevirince metin ve Meta eşlemesi aynen geri gider', async () => {
    put.mockImplementation((_path: string, body: { isActive: boolean }) =>
      Promise.resolve(template({ isActive: body.isActive, isDefault: false, id: 'x' })),
    );
    render(<TemplatesPage />);
    const toggle = await screen.findByRole('switch', { name: /bu mesaj gönderilsin/i });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [path, body] = put.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('notification-templates');
    expect(body).toMatchObject({
      event: 'appointment_confirmation',
      channel: 'whatsapp',
      isActive: false,
      whatsappTemplateName: 'klinara_randevu_olusturuldu_v3',
      whatsappVariables: ['customerName', 'serviceName', 'branchAddress'],
    });
    await waitFor(() => expect(screen.getByText('Kapalı')).toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('yönetim izni yoksa anahtar kilitli', async () => {
    permissions = [PERMISSIONS.NOTIFICATION_READ];
    render(<TemplatesPage />);
    expect(await screen.findByRole('switch', { name: /bu mesaj gönderilsin/i })).toBeDisabled();
  });

  it('konum kartı adresi gösterir, bağlantı alanı yoktur', async () => {
    render(<TemplatesPage />);
    expect(await screen.findByText(BRANCH.address)).toBeInTheDocument();
    expect(screen.queryByLabelText('Google Maps bağlantısı')).not.toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('tüm şubeler seçiliyken konum için şube seçmeyi ister', async () => {
    branchId = null;
    render(<TemplatesPage />);
    expect(
      await screen.findByText('Konumu düzenlemek için üst menüden bir şube seçin.'),
    ).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith('branches', expect.anything());
  });
});
