import { sql, type SQL } from 'drizzle-orm';
import { PERMISSIONS } from '@klinara/shared';
import { hasPermission, type Principal } from '../identity/principal';

/**
 * Bir rapor isteğinin GÖREBİLECEĞİ evren.
 *
 * Raporlar sıradan liste uçlarından farklı bir risk taşıyor: tek bir satır
 * yerine bir TOPLAM dönüyorlar ve bir toplam, içindeki satırları görme
 * yetkisi olmayan birine de anlam ifade eder. "Bu ay 480.000 TL ciro yapıldı"
 * cümlesi, tek tek tahsilatları göremeyen birine de klinik hakkında her şeyi
 * söyler. Bu yüzden daraltma isteğe bağlı bir filtre değil, sorgunun
 * kendisine gömülü bir kısıt.
 */

export interface ReportScope {
  /**
   * Sorgunun kapsayacağı şubeler.
   *
   * `null` "tüm kiracı" demektir ve YALNIZ `tenantWide` rollerde (owner,
   * accountant) oluşur. Şube kapsamlı bir kullanıcı için burası her zaman
   * somut bir listedir; boş liste ise hiçbir şey döndürmez.
   */
  branchIds: string[] | null;

  /**
   * Doldurulmuşsa sorgu bu personele KİLİTLENİR.
   *
   * İstemcinin gönderdiği `staffProfileId` bu durumda yok sayılır — üzerine
   * yazmak değil, hiç dinlememek. Aksi hâlde "kendi verisini gören" bir
   * uygulayıcı, başkasının kimliğini yazarak sınırı test edebilirdi.
   */
  staffProfileId: string | null;

  /** Yanıtta istemciye söylenen kapsam; rozet bundan çiziliyor. */
  kind: 'all' | 'own';

  /** Parasal alanlar SQL'de düşürülsün mü. */
  showMoney: boolean;
}

/**
 * Personel daraltması gerekli mi?
 *
 * `report.revenue:read` taşıyan biri (owner, manager, accountant) tüm
 * personeli görür. Yalnız `report.performance:read.own` taşıyan bir uygulayıcı
 * ise kendi satırına kilitlenir — ve bu izin tek başına parasal alanları
 * AÇAR, çünkü kendi cirosu ve primi tam da raporun konusu. Açtığı tek şey
 * kendi satırıdır.
 */
export function needsOwnScope(principal: Principal): boolean {
  return (
    !hasPermission(principal, PERMISSIONS.REPORT_REVENUE_READ) &&
    hasPermission(principal, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN)
  );
}

/**
 * Şube evreni.
 *
 * İstemci `branchId` verdiyse çağıran onu `BranchAccessService.assertInput`
 * ile zaten doğrulamış olmalı; burada yalnız tek elemanlı listeye indiriyoruz.
 * Vermediyse ve kullanıcı kiracı geneli değilse, üyesi olduğu şubelere
 * daraltılır — "şube seçmedim" isteğinin sessizce tüm kiracıyı taraması,
 * yetkilendirmenin en sık atlanan yolu.
 */
export function branchUniverse(principal: Principal, requested?: string): string[] | null {
  if (requested !== undefined) return [requested];
  return principal.tenantWide ? null : [...principal.branchIds];
}

/**
 * Şube süzgecinin SQL karşılığı.
 *
 * Boş dizi `false` üretiyor ve bu kritik: hiçbir şubeye üye olmayan bir
 * kullanıcı boş rapor görmeli, kiracının tamamını DEĞİL. `in ()` PostgreSQL'de
 * sözdizimsel hata olduğu için üç durum da açıkça yazılıyor.
 *
 * Dizi tek bir metin parametresi olarak taşınıyor: Drizzle bir JS dizisini
 * ayrı ayrı parametrelere açıyor ve şube sayısı sorgunun şeklini değiştirirdi
 * (plan cache'i her sayı için ayrı plan tutardı).
 */
export function branchFilterSql(branchIds: string[] | null, column: SQL): SQL {
  if (branchIds === null) return sql`true`;
  if (branchIds.length === 0) return sql`false`;
  return sql`${column} = any(string_to_array(${branchIds.join(',')}, ',')::uuid[])`;
}
