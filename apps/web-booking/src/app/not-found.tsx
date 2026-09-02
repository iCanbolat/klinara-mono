/**
 * 404 — hem bilinmeyen konak adı hem bilinmeyen yol için TEK ekran.
 *
 * "Bu klinik yok" ile "bu klinik yayında değil" AYIRT EDİLMİYOR: API'nin
 * `404` kararının aynısı — aksi hâlde kimin müşterimiz olduğu, alan adı
 * deneyerek numaralandırılabilirdi.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Sayfa bulunamadı</h1>
      <p className="text-sm opacity-70">
        Bu adreste yayında bir randevu sayfası yok. Bağlantıyı kontrol edip tekrar deneyin.
      </p>
    </main>
  );
}
