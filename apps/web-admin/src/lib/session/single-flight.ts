/**
 * Aynı anahtar için uçuşta olan işi birleştirir.
 *
 * ⚠️ BU, TEK-UÇUŞ GARANTİSİ DEĞİLDİR. Modül kapsamı tek bir Node süreciyle
 * sınırlıdır; iki instance, iki bölge ya da soğuk başlangıç bunu paylaşmaz.
 *
 * Gerçek garanti TARAYICIDA: yenileme token'ı yalnız tarayıcının cookie
 * kavanozunda yaşadığı için hiçbir sunucu instance'ı tarayıcı vermeden
 * yenileme yapamaz, ve tarayıcı tarafındaki `navigator.locks` tüm sekmeleri
 * tek sıraya dizer (`lib/api/client.ts`). Bu dosya yalnızca, aynı ısınmış
 * instance'a aynı milisaniyede düşen iki isteğin API'ye iki kez gitmesini
 * engelleyen bir emniyet ağıdır.
 *
 * Neden önemli: API'nin yenileme uçları YENİDEN KULLANIM TESPİTİ yapıyor
 * (`auth.service.ts`) ve yarışı kaybeden istek "çalınmış token" muamelesi
 * görüp oturum AİLESİNİN TAMAMINI iptal ediyor. Yani buradaki bir çakışmanın
 * bedeli yavaşlık değil, kullanıcının tüm cihazlarından atılması.
 */

const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing as Promise<T>;

  const promise = work().finally(() => {
    // Hem başarıda hem hatada temizleniyor: hata durumunda girdi kalsaydı
    // sonraki her istek aynı reddedilmiş promise'i alır ve oturum bir daha
    // asla yenilenemezdi.
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

/** Yalnız testler için — modül kapsamlı durumu sıfırlar. */
export function resetSingleFlight(): void {
  inFlight.clear();
}
