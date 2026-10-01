import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import { ResendMailSender } from '../../src/lib/mail/resend.sender';
import { invitationMail } from '../../src/modules/identity/invitations.service';

const logger = { debug: vi.fn(), error: vi.fn() } as unknown as PinoLogger;

describe('ResendMailSender', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Resend uç noktasına anahtar, gönderen ve HTML ile POST eder', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'abc' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await new ResendMailSender({ apiKey: 're_test', from: 'Klinara <davet@klinara.app>' }, logger).send({
      to: 'ayse@example.com',
      subject: 'Davet',
      body: 'düz metin',
      html: '<p>biçimli</p>',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Klinara <davet@klinara.app>',
      to: ['ayse@example.com'],
      subject: 'Davet',
      text: 'düz metin',
      html: '<p>biçimli</p>',
    });
  });

  it('reddedilen gönderimde HATA FIRLATIR — kayıt "gönderildi" görünmesin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"domain"}', { status: 403 })));

    await expect(
      new ResendMailSender({ apiKey: 're_test', from: 'x@y.z' }, logger).send({
        to: 'a@b.c',
        subject: 's',
        body: 'b',
      }),
    ).rejects.toThrow('HTTP 403');
  });
});

describe('invitationMail', () => {
  it('bağlantıyı düz metne ve HTML düğmesine yazar; HTML kaçışlıdır', () => {
    const mail = invitationMail('https://app.klinara.app/davet/tok?a=1&b="2"', 48);

    expect(mail.body).toContain('https://app.klinara.app/davet/tok?a=1&b="2"');
    expect(mail.body).toContain('48 saat');
    expect(mail.html).toContain('href="https://app.klinara.app/davet/tok?a=1&amp;b=&quot;2&quot;"');
  });
});
