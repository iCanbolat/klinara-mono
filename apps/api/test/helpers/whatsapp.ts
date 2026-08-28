import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

export interface GraphMockResponse {
  status: number;
  payload: unknown;
}

/**
 * Meta Graph API mock'u.
 *
 * Gerçek WABA hesabı olmadan 8.2'nin tamamı sınanabilsin diye var: istemci
 * `WHATSAPP_API_BASE_URL` ile buraya yönlendiriliyor, yani TEST EDİLEN KOD
 * üretimdekiyle birebir aynı — mock yalnız karşı tarafta duruyor.
 */
export class GraphMock {
  private server: Server | undefined;
  private nextResponses: GraphMockResponse[] = [];
  readonly requests: RecordedRequest[] = [];

  /** Sıradaki isteğe verilecek yanıt; kuyruk boşsa varsayılan başarı döner. */
  queue(response: GraphMockResponse): void {
    this.nextResponses.push(response);
  }

  reset(): void {
    this.nextResponses = [];
    this.requests.length = 0;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (this.server === undefined) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');

    this.requests.push({
      method: req.method ?? 'GET',
      url: req.url ?? '',
      authorization: req.headers.authorization,
      body: raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {},
    });

    const queued = this.nextResponses.shift();
    const response = queued ?? GraphMock.defaultFor(req.url ?? '');
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response.payload));
  }

  private static defaultFor(url: string): GraphMockResponse {
    if (url.includes('message_templates')) {
      return {
        status: 200,
        payload: {
          data: [
            {
              name: 'randevu_hatirlatma',
              language: 'tr',
              category: 'UTILITY',
              status: 'APPROVED',
              components: [
                { type: 'BODY', text: 'Sayın {{1}}, {{2}} randevunuzu hatırlatırız.' },
                {
                  type: 'BUTTONS',
                  buttons: [
                    { type: 'QUICK_REPLY', text: 'Onayla' },
                    { type: 'QUICK_REPLY', text: 'İptal Et' },
                  ],
                },
              ],
            },
          ],
        },
      };
    }
    return {
      status: 200,
      payload: { messages: [{ id: 'wamid.TEST' }] },
    };
  }
}

/** Meta hata gövdesi. */
export const graphError = (status: number, code: number, message = 'hata'): GraphMockResponse => ({
  status,
  payload: { error: { message, code, type: 'OAuthException' } },
});
