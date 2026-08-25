import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { ProbeController } from '../helpers/probe.controller';

const apiRoot = process.cwd();
/** Süreç, derlenmemiş TypeScript'i ts-node ile koşar (dekoratör metadata'sı korunur). */
const TS_NODE = 'ts-node/register/transpile-only';

const BASE_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://klinara_app:pw@127.0.0.1:5433/klinara_test',
};

describe('zarif kapanış', () => {
  it('kapanış sırasında AKTİF istek yarıda kesilmez, tamamlanır', async () => {
    const app: NestExpressApplication = await createTestApp({ controllers: [ProbeController] });
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address() as { port: number };
    const inflight = fetch(`http://127.0.0.1:${address.port}/api/v1/slow`);

    // İstek handler'a ulaşsın diye kısa bir bekleme, sonra kapanışı başlat.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const closing = app.close();

    const response = await inflight;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: true });

    await closing;
  });

  it('SIGTERM alan süreç temiz çıkış kodu (0) ile kapanır', async () => {
    const port = 34_000 + Math.floor(Math.random() * 1_000);
    const child = spawn(process.execPath, ['-r', TS_NODE, 'src/main.ts'], {
      cwd: apiRoot,
      env: {
        ...process.env,
        ...BASE_ENV,
        PORT: String(port),
        HOST: '127.0.0.1',
        SHUTDOWN_GRACE_MS: '5000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    // Sunucu gerçekten istek alabilir hâle gelene kadar bekle.
    const deadline = Date.now() + 40_000;
    let up = false;
    while (!up && Date.now() < deadline && child.exitCode === null) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`);
        up = res.ok;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    expect(up, `sunucu ayağa kalkmadı. stderr: ${stderr}`).toBe(true);

    child.kill('SIGTERM');
    const [code] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
    expect(code, `stderr: ${stderr}`).toBe(0);
  });

  it('geçersiz env ile açılan süreç anlaşılır hata verip 1 ile ölür', async () => {
    const child = spawn(process.execPath, ['-r', TS_NODE, 'src/main.ts'], {
      cwd: apiRoot,
      env: { ...process.env, ...BASE_ENV, PORT: 'not-a-port' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    const [code] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
    expect(code).toBe(1);
    expect(stderr).toContain('AÇILIŞ BAŞARISIZ');
    expect(stderr).toContain('PORT');
    // Yığın izi (stack trace) değil, okunabilir bir mesaj bekliyoruz.
    expect(stderr).not.toContain('at Object.');
  });
});
