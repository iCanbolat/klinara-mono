import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import { NotificationDispatcherService } from '../../src/modules/notifications/notification-dispatcher.service';
import { NotificationSenderWorker } from '../../src/modules/notifications/notification-sender.worker';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import { GraphMock, graphError } from '../helpers/whatsapp';
import { upcomingMonday } from '../helpers/dates';

interface Problem {
  code: string;
}

interface ConversationBody {
  id: string;
  phone: string;
  customer: { id: string; fullName: string } | null;
  status: 'open' | 'closed';
  lastMessagePreview: string | null;
  lastMessageDirection: 'in' | 'out' | null;
  unread: boolean;
  windowOpen: boolean;
}

interface MessageBody {
  id: string;
  direction: 'in' | 'out';
  type: string;
  body: string | null;
  status: string | null;
  event: string | null;
  sentByName: string | null;
  errorDetail: string | null;
  appointmentId: string | null;
}

const APP_SECRET = 'webhook-imza-sirri-uzun';
const WABA_ID = '102290129340398';
const CUSTOMER_WA = '905321234567';
const MONDAY = upcomingMonday();
const at = (hhmm: string) => `${MONDAY}T${hhmm}:00+03:00`;

describe('WhatsApp sohbetleri', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  const graph = new GraphMock();

  beforeAll(async () => {
    database = await startTestDatabase();
    const baseUrl = await graph.start();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        WHATSAPP_API_BASE_URL: baseUrl,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await graph.stop();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    graph.reset();
    clinic = await setupClinic(app);
    await http(app)
      .put('/api/v1/integrations/whatsapp')
      .set(ownerAuth())
      .send({
        wabaId: WABA_ID,
        phoneNumberId: '106540352242922',
        accessToken: 'EAAG-token-a91f',
        appSecret: APP_SECRET,
      })
      .expect(200);
    await http(app).post('/api/v1/integrations/whatsapp/verify').set(ownerAuth()).expect(200);
    graph.reset();
  });

  const ownerAuth = () => auth(clinic.owner.tokens);

  const sign = (body: string): string =>
    `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

  const webhook = (body: string) =>
    http(app)
      .post('/api/v1/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body)
      .expect(200);

  const inbound = (message: Record<string, unknown>, from = CUSTOMER_WA) =>
    webhook(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: WABA_ID,
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '106540352242922' },
                  messages: [
                    {
                      id: `wamid.${Math.random().toString(36).slice(2)}`,
                      from,
                      // Şimdi: pencere AÇIK olsun.
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      ...message,
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    );

  const list = async (query = ''): Promise<ConversationBody[]> => {
    const res = await http(app).get(`/api/v1/conversations${query}`).set(ownerAuth()).expect(200);
    return (res.body as { data: ConversationBody[] }).data;
  };

  const detail = async (id: string) => {
    const res = await http(app).get(`/api/v1/conversations/${id}`).set(ownerAuth()).expect(200);
    return res.body as { conversation: ConversationBody; messages: MessageBody[] };
  };

  const onlyConversation = async (): Promise<ConversationBody> => {
    const rows = await list('?status=all');
    expect(rows).toHaveLength(1);
    return rows[0] as ConversationBody;
  };

  // -------------------------------------------------------------------------
  it('gelen mesaj sohbet açar; liste okunmamış ve pencere açık gösterir', async () => {
    await inbound({ text: { body: 'Merhaba, yarınki randevumu değiştirebilir miyim?' } });

    const conversation = await onlyConversation();
    expect(conversation.phone).toBe('+905321234567');
    expect(conversation.customer?.id).toBe(clinic.customer.id);
    expect(conversation.unread).toBe(true);
    expect(conversation.windowOpen).toBe(true);
    expect(conversation.lastMessageDirection).toBe('in');
    expect(conversation.lastMessagePreview).toContain('randevumu');

    const unread = await http(app)
      .get('/api/v1/conversations/unread-count')
      .set(ownerAuth())
      .expect(200);
    expect((unread.body as { count: number }).count).toBe(1);

    await http(app)
      .post(`/api/v1/conversations/${conversation.id}/read`)
      .set(ownerAuth())
      .expect(204);
    expect((await onlyConversation()).unread).toBe(false);
  });

  it('resepsiyonun cevabı serbest metin olarak gider ve akışta yazarıyla görünür', async () => {
    await inbound({ text: { body: 'Merhaba' } });
    const { id } = await onlyConversation();

    const sent = await http(app)
      .post(`/api/v1/conversations/${id}/messages`)
      .set(ownerAuth())
      .send({ body: '  Merhaba Ayşe Hanım, tabii ki.  ' })
      .expect(201);
    expect(sent.body).toMatchObject({ direction: 'out', status: 'sent', body: 'Merhaba Ayşe Hanım, tabii ki.' });

    expect(graph.requests.at(-1)?.body).toMatchObject({
      type: 'text',
      to: '+905321234567',
      text: { body: 'Merhaba Ayşe Hanım, tabii ki.' },
    });

    const { conversation, messages } = await detail(id);
    expect(messages.map((row) => row.direction)).toEqual(['in', 'out']);
    const reply = messages[1] as MessageBody;
    expect(reply.event).toBe('staff_reply');
    expect(reply.sentByName).not.toBeNull();
    expect(conversation.lastMessageDirection).toBe('out');
    // Cevap yazan okumuştur.
    expect(conversation.unread).toBe(false);
  });

  it('24 saat penceresi kapalıysa cevap 422 alır ve Meta’ya gidilmez', async () => {
    await inbound({ text: { body: 'Merhaba' } });
    const { id } = await onlyConversation();
    await database.ownerPool.query(
      `update conversations set last_inbound_at = now() - interval '25 hours'`,
    );

    const rejected = await http(app)
      .post(`/api/v1/conversations/${id}/messages`)
      .set(ownerAuth())
      .send({ body: 'Merhaba' })
      .expect(422);
    expect((rejected.body as Problem).code).toBe('WHATSAPP_WINDOW_CLOSED');
    expect(graph.requests).toHaveLength(0);
    expect((await detail(id)).conversation.windowOpen).toBe(false);
  });

  it('gönderim hatası HTTP hatası değil — `failed` mesaj olarak döner', async () => {
    await inbound({ text: { body: 'Merhaba' } });
    const { id } = await onlyConversation();
    graph.queue(graphError(400, 131026, 'Recipient is not a WhatsApp user'));

    const sent = await http(app)
      .post(`/api/v1/conversations/${id}/messages`)
      .set(ownerAuth())
      .send({ body: 'Merhaba' })
      .expect(201);
    expect(sent.body).toMatchObject({ status: 'failed' });
    expect((sent.body as MessageBody).errorDetail).toContain('WhatsApp user');
  });

  it('kayıtlı olmayan numara: müşterisiz sohbet açılır ve sonradan bağlanır', async () => {
    await inbound({ text: { body: 'Fiyat alabilir miyim?' } }, '905559998877');
    const conversation = await onlyConversation();
    expect(conversation.customer).toBeNull();

    const linked = await http(app)
      .put(`/api/v1/conversations/${conversation.id}/customer`)
      .set(ownerAuth())
      .send({ customerId: clinic.customer.id })
      .expect(200);
    expect((linked.body as ConversationBody).customer?.id).toBe(clinic.customer.id);

    const inbox = await database.ownerPool.query<{ customer_id: string | null }>(
      'select customer_id from inbound_messages',
    );
    expect(inbox.rows[0]?.customer_id).toBe(clinic.customer.id);
  });

  it('kayıtlı olmayan numaraya cevap yazılabilir (alıcı sohbetin kendisi)', async () => {
    await inbound({ text: { body: 'Fiyat alabilir miyim?' } }, '905559998877');
    const { id } = await onlyConversation();

    const sent = await http(app)
      .post(`/api/v1/conversations/${id}/messages`)
      .set(ownerAuth())
      .send({ body: 'Merhaba, hangi hizmet için?' })
      .expect(201);
    expect(sent.body).toMatchObject({ status: 'sent' });
    expect((await detail(id)).messages.at(-1)?.body).toBe('Merhaba, hangi hizmet için?');
  });

  it('kapatma bekleyen gelen mesajları işler; yeni mesaj sohbeti yeniden açar', async () => {
    await inbound({ text: { body: 'Merhaba' } });
    const { id } = await onlyConversation();

    const closed = await http(app)
      .post(`/api/v1/conversations/${id}/close`)
      .set(ownerAuth())
      .expect(200);
    expect((closed.body as ConversationBody).status).toBe('closed');
    expect(await list()).toHaveLength(0);

    const inbox = await http(app).get('/api/v1/inbox').set(ownerAuth()).expect(200);
    expect(inbox.body).toHaveLength(0);

    await inbound({ text: { body: 'Bir sorum daha var' } });
    const reopened = await onlyConversation();
    expect(reopened.id).toBe(id);
    expect(reopened.status).toBe('open');
    expect(reopened.unread).toBe(true);
  });

  it('`notification:send` taşımayan rol sohbetlere giremez', async () => {
    await http(app)
      .get('/api/v1/conversations')
      .set(auth(clinic.practitioner.tokens))
      .expect(403);
  });

  // -------------------------------------------------------------------------
  it('hatırlatma Onayla/İptal butonlarıyla gider; butona basmak randevuyu onaylar ve sohbette görünür', async () => {
    const created = await http(app)
      .post('/api/v1/appointments')
      .set(ownerAuth())
      .set(branchHeader(clinic.branch.id))
      .send({
        branchId: clinic.branch.id,
        customerId: clinic.customer.id,
        startsAt: at('14:00'),
        services: [
          { serviceId: clinic.quickService.id, staffProfileId: clinic.practitioner.staffProfileId },
        ],
      })
      .expect(201);
    const appointmentId = (created.body as { id: string }).id;

    const queued = await app.get(TenantTxService).runForTenant(clinic.tenant.id, (tx) =>
      app.get(NotificationDispatcherService).enqueue(tx, clinic.tenant.id, {
        event: 'appointment_reminder',
        customerId: clinic.customer.id,
        branchId: clinic.branch.id,
        channels: ['whatsapp'],
        appointmentId,
        variables: {
          customerName: 'Ayşe',
          branchName: 'Merkez',
          appointmentAt: '14:00',
          serviceName: 'Lazer',
        },
      }),
    );
    if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
    await app
      .get(NotificationSenderWorker)
      .handle({ tenantId: clinic.tenant.id, messageId: queued.messageId });

    const template = (
      graph.requests.at(-1)?.body as {
        template: { name: string; components: { type: string; sub_type?: string; index?: string; parameters: { payload?: string }[] }[] };
      }
    ).template;
    expect(template.name).toBe('klinara_randevu_hatirlatma');
    const buttons = template.components.filter((component) => component.type === 'button');
    expect(buttons.map((button) => [button.sub_type, button.index])).toEqual([
      ['quick_reply', '0'],
      ['quick_reply', '1'],
    ]);

    // Token DÜZ METİN saklanmıyor; iki eylem de bu mesaja bağlı.
    const actions = await database.ownerPool.query<{ action: string; message_log_id: string }>(
      'select action::text as action, message_log_id from message_actions order by action::text',
    );
    expect(actions.rows.map((row) => row.action)).toEqual(['cancel', 'confirm']);
    expect(actions.rows.every((row) => row.message_log_id === queued.messageId)).toBe(true);

    // Müşteri "Onaylıyorum"a basıyor.
    const confirmPayload = buttons[0]?.parameters[0]?.payload as string;
    await inbound({ type: 'button', button: { payload: confirmPayload, text: 'Onaylıyorum' } });

    const appointment = await http(app)
      .get(`/api/v1/appointments/${appointmentId}`)
      .set(ownerAuth())
      .set(branchHeader(clinic.branch.id))
      .expect(200);
    expect((appointment.body as { status: string }).status).toBe('confirmed');

    // Sohbette: hatırlatma (randevuya bağlı), buton yanıtı ve otomatik cevap.
    const { messages } = await detail((await onlyConversation()).id);
    const reminder = messages.find((row) => row.event === 'appointment_reminder');
    expect(reminder?.appointmentId).toBe(appointmentId);
    expect(reminder?.body).toContain('hatırlatırız');
    expect(messages.find((row) => row.type === 'button')?.body).toBe('Onaylıyorum');
    expect(messages.find((row) => row.event === 'auto_reply')?.body).toContain('onaylandı');

    // Buton yanıtı otomatik işlendi: gelen kutusunda bekleyen iş değil.
    const inbox = await http(app).get('/api/v1/inbox').set(ownerAuth()).expect(200);
    expect(inbox.body).toHaveLength(0);
  });

  it('template onay webhook’u yansımayı günceller', async () => {
    await webhook(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: WABA_ID,
            changes: [
              {
                field: 'message_template_status_update',
                value: {
                  event: 'APPROVED',
                  message_template_name: 'klinara_randevu_iptal',
                  message_template_language: 'tr',
                },
              },
            ],
          },
        ],
      }),
    );

    const templates = await http(app)
      .get('/api/v1/integrations/whatsapp/templates')
      .set(ownerAuth())
      .expect(200);
    expect(templates.body).toContainEqual(
      expect.objectContaining({ name: 'klinara_randevu_iptal', status: 'approved' }),
    );
  });
  // -------------------------------------------------------------------------
  describe('pencere kapalıyken şablon', () => {
    const addTemplate = (row: {
      name: string;
      category?: string;
      status?: string;
      count?: number;
      body?: string | null;
      buttons?: { type: string; text: string }[];
    }) =>
      database.ownerPool.query(
        `insert into whatsapp_templates
           (tenant_id, name, language, category, status, body_variable_count, body_text, buttons)
         values ($1, $2, 'tr', $3, $4, $5, $6, $7::jsonb)`,
        [
          clinic.tenant.id,
          row.name,
          row.category ?? 'UTILITY',
          row.status ?? 'approved',
          row.count ?? 2,
          row.body === undefined ? 'Merhaba {{1}}, {{2}} olarak size ulaşmak istedik.' : row.body,
          JSON.stringify(row.buttons ?? []),
        ],
      );

    const closedConversation = async (): Promise<string> => {
      await inbound({ text: { body: 'Merhaba' } });
      const { id } = await onlyConversation();
      await database.ownerPool.query(
        `update conversations set last_inbound_at = now() - interval '25 hours'`,
      );
      await database.ownerPool.query(`delete from whatsapp_templates`);
      graph.reset();
      return id;
    };

    const sendTemplate = (id: string, body: Record<string, unknown>) =>
      http(app).post(`/api/v1/conversations/${id}/template`).set(ownerAuth()).send(body);

    it('liste yalnız onaylı, butonsuz UTILITY şablonlarını önerilerle döner', async () => {
      const id = await closedConversation();
      await addTemplate({ name: 'klinara_gelmedi_takip' });
      await addTemplate({ name: 'kampanya', category: 'MARKETING', count: 1, body: 'Fırsat {{1}}' });
      await addTemplate({ name: 'bekleyen', status: 'pending' });
      await addTemplate({ name: 'butonlu', buttons: [{ type: 'QUICK_REPLY', text: 'Evet' }] });
      await addTemplate({ name: 'booking_otp', category: 'AUTHENTICATION', count: 1 });
      // Senkronizasyon öncesi satır: gövde standart setten tamamlanır.
      await addTemplate({ name: 'klinara_randevu_iptal', count: 3, body: null });

      const res = await http(app)
        .get(`/api/v1/conversations/${id}/templates`)
        .set(ownerAuth())
        .expect(200);
      const options = res.body as {
        name: string;
        bodyText: string;
        variableNames: (string | null)[];
        suggestedParameters: string[];
      }[];

      // Pazarlama şablonu Meta'da açılmış olsa da önerilmez.
      expect(options.map((row) => row.name)).toEqual([
        'klinara_gelmedi_takip',
        'klinara_randevu_iptal',
      ]);
      expect(options[0]?.variableNames).toEqual(['customerName', 'branchName']);
      expect(options[0]?.suggestedParameters).toEqual(['Ayşe Yılmaz', clinic.branch.name]);
      expect(options[1]?.bodyText).toContain('{{1}}');
    });

    it('pencere kapalıyken şablon gider; Meta’ya template isteği, kayıtta işlenmiş metin', async () => {
      const id = await closedConversation();
      await addTemplate({ name: 'klinara_gelmedi_takip' });

      const sent = await sendTemplate(id, {
        templateName: 'klinara_gelmedi_takip',
        language: 'tr',
        parameters: ['Ayşe Yılmaz', 'Kadıköy'],
      }).expect(201);
      const message = sent.body as MessageBody;
      expect(message).toMatchObject({ status: 'sent', type: 'template', direction: 'out' });
      expect(message.body).toBe('Merhaba Ayşe Yılmaz, Kadıköy olarak size ulaşmak istedik.');

      expect(graph.requests).toHaveLength(1);
      const request = graph.requests[0]?.body as {
        type: string;
        template: { name: string; components: { parameters: { text: string }[] }[] };
      };
      expect(request.type).toBe('template');
      expect(request.template.name).toBe('klinara_gelmedi_takip');
      expect(request.template.components[0]?.parameters.map((p) => p.text)).toEqual([
        'Ayşe Yılmaz',
        'Kadıköy',
      ]);

      const thread = await detail(id);
      const last = thread.messages.at(-1);
      expect(last).toMatchObject({ type: 'template', event: 'staff_reply' });
      expect(last?.body).toContain('Kadıköy');
      // Pencere hâlâ kapalı: müşteri yazana kadar serbest metin yok.
      expect(thread.conversation.windowOpen).toBe(false);
    });

    it.each([
      ['onaysız', { name: 'bekleyen', status: 'pending' }],
      ['butonlu', { name: 'butonlu', buttons: [{ type: 'QUICK_REPLY', text: 'Evet' }] }],
      ['OTP', { name: 'booking_otp', category: 'AUTHENTICATION' }],
    ])('%s şablon 422 alır ve Meta’ya gidilmez', async (_label, row) => {
      const id = await closedConversation();
      await addTemplate(row);
      const res = await sendTemplate(id, {
        templateName: row.name,
        language: 'tr',
        parameters: ['a', 'b'],
      }).expect(422);
      expect((res.body as Problem).code).toBe('WHATSAPP_TEMPLATE_NOT_APPROVED');
      expect(graph.requests).toHaveLength(0);
    });

    it('parametre sayısı tutmazsa 422', async () => {
      const id = await closedConversation();
      await addTemplate({ name: 'klinara_gelmedi_takip' });
      const res = await sendTemplate(id, {
        templateName: 'klinara_gelmedi_takip',
        language: 'tr',
        parameters: ['Ayşe'],
      }).expect(422);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
      expect(graph.requests).toHaveLength(0);
    });

    it('pazarlama şablonu listede yok ve gönderilemez', async () => {
      const id = await closedConversation();
      await addTemplate({ name: 'kampanya', category: 'MARKETING', count: 1, body: 'Fırsat {{1}}' });
      const res = await sendTemplate(id, {
        templateName: 'kampanya',
        language: 'tr',
        parameters: ['%20'],
      }).expect(422);
      expect((res.body as Problem).code).toBe('WHATSAPP_TEMPLATE_NOT_APPROVED');
      expect(graph.requests).toHaveLength(0);
    });

    it('kayıtlı olmayan numarada şablon gider; müşteri adı önerilmez', async () => {
      await inbound({ text: { body: 'Fiyat?' } }, '905559998877');
      const { id } = await onlyConversation();
      await database.ownerPool.query(
        `update conversations set last_inbound_at = now() - interval '25 hours'`,
      );
      await database.ownerPool.query(`delete from whatsapp_templates`);
      await addTemplate({ name: 'klinara_gelmedi_takip' });
      graph.reset();

      const options = await http(app)
        .get(`/api/v1/conversations/${id}/templates`)
        .set(ownerAuth())
        .expect(200);
      expect((options.body as { suggestedParameters: string[] }[])[0]?.suggestedParameters).toEqual([
        '',
        clinic.branch.name,
      ]);

      await sendTemplate(id, {
        templateName: 'klinara_gelmedi_takip',
        language: 'tr',
        parameters: ['Merhaba', 'Kadıköy'],
      }).expect(201);
      expect(graph.requests).toHaveLength(1);
    });

    it('Meta hatası `failed` mesaj olarak döner', async () => {
      const id = await closedConversation();
      await addTemplate({ name: 'klinara_gelmedi_takip' });
      graph.queue(graphError(400, 132001, 'Template name does not exist in the translation'));
      const sent = await sendTemplate(id, {
        templateName: 'klinara_gelmedi_takip',
        language: 'tr',
        parameters: ['Ayşe', 'Kadıköy'],
      }).expect(201);
      expect(sent.body).toMatchObject({ status: 'failed', type: 'template' });
    });

    it('`notification:send` taşımayan rol şablon gönderemez', async () => {
      const id = await closedConversation();
      await http(app)
        .post(`/api/v1/conversations/${id}/template`)
        .set(auth(clinic.practitioner.tokens))
        .send({ templateName: 'x', language: 'tr', parameters: [] })
        .expect(403);
    });
  });
});
