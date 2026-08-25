import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildApp } from '../../src/app.js';
import { testEnv } from '../helpers/env.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('zarif kapanış', () => {
  it('kapanış sırasında AKTİF istek yarıda kesilmez, tamamlanır', async () => {
    const app = await buildApp({ env: testEnv(), loggerOverride: false });

    let handlerReached = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // buildApp henüz `ready()` çağırmadığı için testte ek rota kaydedebiliyoruz.
    app.get('/slow', async () => {
      handlerReached = true;
      await gate;
      return { done: true };
    });

    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('port alınamadı');

    const inflight = fetch(`http://127.0.0.1:${address.port}/slow`);

    // İstek gerçekten handler'a ulaşana kadar bekle.
    const deadline = Date.now() + 5_000;
    while (!handlerReached && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(handlerReached).toBe(true);

    // Kapanışı başlat: bu noktada istek hâlâ uçuşta.
    const closing = app.close();
    release();

    const response = await inflight;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: true });

    await closing;
  });

  it('SIGTERM alan süreç temiz çıkış kodu (0) ile kapanır', async () => {
    const port = 34_000 + Math.floor(Math.random() * 1_000);
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: apiRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        PORT: String(port),
        HOST: '127.0.0.1',
        SHUTDOWN_GRACE_MS: '5000',
        DATABASE_URL: 'postgres://klinara_app:pw@127.0.0.1:5433/klinara_test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    // Sunucu gerçekten istek alabilir hâle gelene kadar bekle.
    const deadline = Date.now() + 15_000;
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
    expect(code).toBe(0);
  });

  it('geçersiz env ile açılan süreç anlaşılır hata verip 1 ile ölür', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: apiRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgres://klinara_app:pw@127.0.0.1:5433/klinara_test',
        PORT: 'not-a-port',
      },
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
