/**
 * Bir supertest yanıtını TEŞHİS EDİLEBİLİR biçimde özetler.
 *
 * Somut bir vakadan doğdu: tam koşumda rastgele bir fixture adımı, gövdesi
 * bizim RFC 9457 biçimimiz OLMAYAN bir 401 alıyordu. Yalnız durum kodu ve
 * gövde basıldığı sürece "bu yanıtı kim üretti" sorusu cevapsız kalıyor —
 * isteğin gittiği adres ve `server`/`via` gibi başlıklar, yanıtın test
 * uygulamasından mı yoksa araya giren bir katmandan mı geldiğini tek bakışta
 * ayırıyor (bkz. Ek P).
 */
export function describeResponse(res: unknown): string {
  const candidate = res as {
    request?: { url?: string };
    headers?: Record<string, string>;
  };
  const headers = candidate.headers ?? {};
  const interesting = ['server', 'via', 'x-request-id', 'cf-ray', 'content-type', 'date'];
  const shown = interesting
    .filter((name) => headers[name] !== undefined)
    .map((name) => `${name}=${headers[name] ?? ''}`)
    .join(' ');
  return `[url=${candidate.request?.url ?? '?'} ${shown}]`;
}
