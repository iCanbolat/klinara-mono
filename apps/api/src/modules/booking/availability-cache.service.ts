import { Injectable } from '@nestjs/common';
import type { AvailabilityResponseDto } from './dto/availability.dto';

/**
 * Uygunluk sonucu için kısa ömürlü süreç-içi cache.
 *
 * Neden: online randevu sayfası ve takvim ekranı aynı gün için aynı sorguyu
 * arka arkaya sorar; sorgu ucuz değildir (slot ızgarası × personel).
 *
 * TTL neden bu kadar KISA: uygunluk yarışan bir veridir. Bir randevu
 * yazıldığında cache açıkça temizlenir; TTL yalnızca invalidasyonun kaçtığı
 * bir yol kalırsa devreye giren güvenlik ağıdır.
 *
 * ⚠️ Süreç-içi cache tek instance varsayar. Yatay ölçeklemede invalidasyon bir
 * kanal üzerinden yayınlanmalıdır (Batch 10.2); TTL o güne kadar bayatlığın
 * üst sınırını belirler.
 */
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  value: AvailabilityResponseDto;
  expiresAt: number;
}

@Injectable()
export class AvailabilityCacheService {
  private readonly cache = new Map<string, CacheEntry>();

  static key(tenantId: string, parts: (string | number | undefined)[]): string {
    return `${tenantId}|${parts.map((part) => part ?? '').join('|')}`;
  }

  get(key: string): AvailabilityResponseDto | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: AvailabilityResponseDto): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  /**
   * Kiracının TÜM uygunluk sonuçlarını düşürür.
   *
   * Randevu, çalışma saati, istisna, yetkinlik ve katalog yazımlarının hepsi
   * uygunluğu etkiler. Hangi anahtarın etkilendiğini tek tek hesaplamak, bir
   * gün bir yolu atlamak demektir; kiracı bazında topluca düşürmek hem ucuz
   * hem de hatasızdır.
   */
  invalidateTenant(tenantId: string): void {
    const prefix = `${tenantId}|`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
