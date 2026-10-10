-- Doğrudan randevu bağlantısı: `{kök}/randevu?klinik={slug}`.
--
-- Sayfa içeriğini hiç yayınlamamış (ya da yayından kaldırmış) bir klinik de
-- online randevu alabilmeli: o durumda pazarlama sayfası yerine yalnız randevu
-- akışı gösterilir. Bunun için public çözümleme yayınlanmamış siteyi de
-- GÖRMEK zorunda; 0035'teki `status = 'published'` koşulu politikadan çıkıyor.
--
-- Yayın kapısı ortadan kalkmıyor, yer değiştiriyor: yayınlanmamış sitenin
-- İÇERİĞİ (bloklar, SEO) `PublicSiteService.getSite`te boş dönüyor ve KVKK
-- metni yayında değilse site yine `404`. Politikanın koruduğu şey artık
-- "silinmiş site çözülemez" ve "bayrak olmadan hiçbir satır görünmez".
drop policy booking_sites_public_lookup on booking_sites;
create policy booking_sites_public_lookup on booking_sites
  for select
  using (current_public_flow() and deleted_at is null);
