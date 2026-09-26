import { describe, it, expect, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import { BookingOtpSender } from '../../src/modules/public/booking-otp.sender';
import type {
  WhatsAppOutbound,
  WhatsAppSenderService,
} from '../../src/modules/integrations/whatsapp-sender.service';

const input = {
  tenantId: 't1',
  channel: 'whatsapp' as const,
  phone: '905551112233',
  code: '123456',
  clinicName: 'Demo Klinik',
};

function setup(
  whatsapp: (message: WhatsAppOutbound) => Promise<unknown>,
  nodeEnv: 'development' | 'production' = 'development',
) {
  const sms = { send: vi.fn().mockResolvedValue(undefined) };
  const wa = { send: vi.fn((_tenantId: string, message: WhatsAppOutbound) => whatsapp(message)) };
  const logger = { warn: vi.fn() };
  const config = { get: vi.fn().mockReturnValue(nodeEnv) };
  const sender = new BookingOtpSender(
    sms,
    logger as unknown as PinoLogger,
    config as unknown as ConstructorParameters<typeof BookingOtpSender>[2],
    wa as unknown as WhatsAppSenderService,
  );
  return { sender, sms, wa };
}

describe('BookingOtpSender', () => {
  it('onaylı template varsa yalnız template gönderir', async () => {
    const { sender, sms, wa } = setup(() => Promise.resolve({ messageId: 'm1' }));
    await sender.send(input);
    expect(wa.send).toHaveBeenCalledTimes(1);
    expect(wa.send.mock.calls[0]?.[1].templateName).toBe('booking_otp');
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('template başarısızsa ve pencere açıksa kodu serbest metinle gönderir', async () => {
    const { sender, sms, wa } = setup((message) =>
      message.templateName === undefined
        ? Promise.resolve({ messageId: 'm2' })
        : Promise.reject(new Error('template yok')),
    );
    await sender.send(input);
    expect(wa.send).toHaveBeenCalledTimes(2);
    expect(wa.send.mock.calls[1]?.[1]).toEqual({
      to: input.phone,
      body: 'Demo Klinik randevu doğrulama kodunuz: 123456',
    });
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('ÜRETİMDE serbest metin denenmez; doğrudan SMS’e düşülür', async () => {
    const { sender, sms, wa } = setup(
      (message) =>
        message.templateName === undefined
          ? Promise.resolve({ messageId: 'm2' })
          : Promise.reject(new Error('template yok')),
      'production',
    );
    await sender.send(input);
    expect(wa.send).toHaveBeenCalledTimes(1);
    expect(sms.send).toHaveBeenCalledTimes(1);
  });

  it('template ve serbest metin başarısızsa SMS’e düşer', async () => {
    const { sender, sms } = setup(() => Promise.reject(new Error('pencere kapalı')));
    await sender.send(input);
    expect(sms.send).toHaveBeenCalledWith({
      to: input.phone,
      body: 'Demo Klinik randevu doğrulama kodunuz: 123456',
    });
  });

  it('SMS kanalında WhatsApp denenmez', async () => {
    const { sender, sms, wa } = setup(() => Promise.resolve({ messageId: 'm1' }));
    await sender.send({ ...input, channel: 'sms' });
    expect(wa.send).not.toHaveBeenCalled();
    expect(sms.send).toHaveBeenCalledTimes(1);
  });
});
