import { afterEach, describe, expect, it } from 'vitest';
import { resetSingleFlight, singleFlight } from '../../src/lib/session/single-flight';

afterEach(() => {
  resetSingleFlight();
});

describe('single-flight — aynı anahtarda iş birleştirme', () => {
  it('eş zamanlı çağrılar TEK işe düşüyor', async () => {
    // Bedeli yavaşlık değil: API'nin yeniden kullanım tespiti, yarışı kaybeden
    // isteği "çalınmış token" sayıp oturum ailesini iptal ediyor.
    let calls = 0;
    const work = async (): Promise<string> => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'sonuc';
    };
    const results = await Promise.all([
      singleFlight('s1', work),
      singleFlight('s1', work),
      singleFlight('s1', work),
    ]);
    expect(results).toEqual(['sonuc', 'sonuc', 'sonuc']);
    expect(calls).toBe(1);
  });

  it('FARKLI anahtarlar birbirini engellemiyor', async () => {
    let calls = 0;
    const work = async (): Promise<number> => {
      calls += 1;
      return calls;
    };
    await Promise.all([singleFlight('s1', work), singleFlight('s2', work)]);
    expect(calls).toBe(2);
  });

  it('iş bittikten SONRA yeni çağrı yeniden koşuyor', async () => {
    let calls = 0;
    const work = async (): Promise<number> => (calls += 1);
    await singleFlight('s1', work);
    await singleFlight('s1', work);
    expect(calls).toBe(2);
  });

  it('HATA girdiyi temizliyor — oturum kalıcı olarak kilitlenmiyor', async () => {
    // Girdi kalsaydı sonraki her istek aynı reddedilmiş promise'i alır ve
    // oturum bir daha asla yenilenemezdi.
    let calls = 0;
    const failing = async (): Promise<never> => {
      calls += 1;
      throw new Error('yukarı akış düştü');
    };
    await expect(singleFlight('s1', failing)).rejects.toThrow('yukarı akış düştü');
    await expect(singleFlight('s1', failing)).rejects.toThrow('yukarı akış düştü');
    expect(calls).toBe(2);
  });
});
