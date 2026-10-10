import { redirect } from 'next/navigation';

/**
 * Alan adları artık "Randevu sayfası"nın bir sekmesi. Eski yer imleri ve
 * paylaşılmış bağlantılar kırılmasın diye rota yönlendirme olarak kalıyor.
 */
export default function Page(): never {
  redirect('/sayfa?tab=alan-adlari');
}
