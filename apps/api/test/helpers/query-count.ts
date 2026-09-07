import type { INestApplication } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../../src/database/database.constants';

/**
 * Havuzdan geçen SQL sorgularını sayan test aracı.
 *
 * N+1 regresyonlarının tek güvenilir kanıtı sorgu SAYISIDIR: süre ölçümü
 * makine yüküne duyarlıdır ve yeşil bir p95 testi, kalem başına bir sorgu
 * atan bir kodu 50 randevuda hâlâ geçirir. Sayaç ise ölçekten bağımsızdır —
 * "bir randevuyla kaç sorgu, yüz randevuyla kaç sorgu" sorusu, kodun
 * toplu mu tekil mi okuduğunu doğrudan söyler.
 *
 * Drizzle transaction'ları `pool.connect()` üzerinden açar, dolayısıyla tüm
 * repository sorguları buradan geçer.
 *
 * ⚠️ İstemciler havuzdan TEKRAR TEKRAR çıkar. Her çıkışta sarmak, aynı
 * `query` çağrısını sarmalayıcı sayısı kadar sayardı ve sayaç katlanarak
 * şişerdi. Bu yüzden istemci bir kez sarılıp bir sembolle işaretlenir.
 */
const COUNTED = Symbol.for('klinara.test.counted');

export interface QueryCounter {
  /** O ana kadar sayılan sorgu adedi. */
  readonly count: number;
  /** Sayacı sıfırlar — ısıtma çağrılarından sonra kullanılır. */
  reset(): void;
  /** Havuzu eski hâline döndürür. `finally` içinde çağrılmalıdır. */
  restore(): void;
}

/**
 * Verilen uygulamanın havuzunu sarar ve sorguları saymaya başlar.
 *
 * Kullanım:
 * ```ts
 * const counter = countQueries(app);
 * try {
 *   await warmUp();          // izin cache'i, şube cache'i
 *   counter.reset();
 *   await request();
 *   expect(counter.count).toBeLessThan(15);
 * } finally {
 *   counter.restore();
 * }
 * ```
 */
export function countQueries(app: INestApplication): QueryCounter {
  const pool = app.get<pg.Pool>(PG_POOL);
  const originalConnect = pool.connect.bind(pool);
  let queries = 0;

  (pool as unknown as { connect: () => Promise<pg.PoolClient> }).connect = async () => {
    const client = await originalConnect();
    const marked = client as unknown as Record<symbol, boolean>;
    if (marked[COUNTED] !== true) {
      const original = client.query.bind(client) as (...args: unknown[]) => unknown;
      (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
        queries += 1;
        return original(...args);
      };
      marked[COUNTED] = true;
    }
    return client;
  };

  return {
    get count() {
      return queries;
    },
    reset() {
      queries = 0;
    },
    restore() {
      (pool as unknown as { connect: unknown }).connect = originalConnect;
    },
  };
}

/**
 * Bir işlemin kaç sorgu attığını ölçer ve havuzu her hâlükârda geri verir.
 *
 * Tek atışlık ölçümler için `countQueries`ten daha kısa; ısıtma gerektiren
 * senaryolarda `countQueries` + `reset()` kullanılmalıdır.
 */
export async function measureQueries<T>(
  app: INestApplication,
  action: () => Promise<T>,
): Promise<{ result: T; queries: number }> {
  const counter = countQueries(app);
  try {
    const result = await action();
    return { result, queries: counter.count };
  } finally {
    counter.restore();
  }
}
