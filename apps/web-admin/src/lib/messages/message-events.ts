/**
 * Bildirim kancası (`use-staff-notifications`) soketten ya da yoklamadan "yeni
 * mesaj/teslim hatası" gördüğünde bu küçük yayın kanalıyla sohbet listesi ve
 * açık sohbeti hemen tazeletiyor — kendi yoklama aralıklarını beklemeden.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function emitMessageEvent(): void {
  for (const listener of listeners) listener();
}

export function onMessageEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
