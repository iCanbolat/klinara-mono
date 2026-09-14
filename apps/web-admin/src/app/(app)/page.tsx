import { redirect } from 'next/navigation';

/**
 * Kök rota karşılama sayfasına yönlendiriyor.
 *
 * Panelin index'i `/dashboard`: `/` ayrı bir sayfa olarak kalsaydı menüde
 * "Genel bakış" ögesinin etkin durumu (`pathname === item.path`) iki farklı
 * adreste ayrı ayrı hesaplanmak zorunda kalırdı. Eski yer imleri ve girişten
 * sonraki `next` yönlendirmeleri bu satır sayesinde kırılmıyor.
 */
export default function Page(): never {
  redirect('/dashboard');
}
