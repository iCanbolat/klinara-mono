'use client';

import { publicEnv } from '@/config/env';
import { api, SessionExpiredError } from '@/lib/api/client';

/**
 * Panelin anlık olay soketi — sekme başına TEK bağlantı.
 *
 * Soket VERİ TAŞIMAZ: "yeni bildirim var" der, dinleyen kanca veriyi olağan
 * yetkili uçtan (`/api/a/...`) yeniden okur. Kimlik de oturum token'ı değil:
 * BFF üzerinden alınan, yalnız bu kanalı açan kısa ömürlü bir bilet — erişim
 * token'ı hâlâ tarayıcıya inmiyor.
 *
 * Varsayılan adres AYNI ORIGIN (`/api/realtime`); Next onu API'ye aktarıyor
 * (`next.config.ts`). Kenar proxy'si soketi doğrudan API'ye yönlendiriyorsa
 * `NEXT_PUBLIC_REALTIME_URL` tam bir `wss://` adresi verir.
 *
 * Soket kopuksa hiçbir şey bozulmaz: kancalar yoklamaya devam ediyor, yalnız
 * daha seyrek olanı bırakıp sık olana dönüyorlar.
 */

export type RealtimeMessage =
  | { type: 'staff_notification'; kind: string }
  /** Bağlantı (yeniden) kuruldu ya da sunucu olay kaçırmış olabilir: baştan oku. */
  | { type: 'resync' };

type Listener = (message: RealtimeMessage) => void;
type StatusListener = () => void;

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

const listeners = new Set<Listener>();
const statusListeners = new Set<StatusListener>();

let socket: WebSocket | null = null;
let connected = false;
let connecting = false;
let retryMs = RETRY_MIN_MS;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Oturum bittiğinde yeniden deneme durur; sekmeye dönüş tekrar başlatır. */
let paused = false;

function endpoint(): string {
  if (publicEnv.realtimeUrl !== '') return publicEnv.realtimeUrl;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/realtime`;
}

function setConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  for (const listener of statusListeners) listener();
}

function scheduleRetry(): void {
  if (listeners.size === 0 || paused || retryTimer !== null) return;
  // Sunucu yeniden başladığında tüm sekmeler aynı anda dönmesin.
  const delay = retryMs * (0.5 + Math.random());
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, delay);
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
}

async function connect(): Promise<void> {
  if (socket !== null || connecting || listeners.size === 0) return;
  connecting = true;
  let ticket: string;
  try {
    ({ ticket } = await api.post<{ ticket: string }>('realtime/ticket'));
  } catch (caught) {
    connecting = false;
    if (caught instanceof SessionExpiredError) paused = true;
    scheduleRetry();
    return;
  }
  connecting = false;
  // Bilet beklenirken son dinleyici ayrılmış olabilir.
  if (listeners.size === 0) return;

  const ws = new WebSocket(endpoint());
  socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket }));
  ws.onmessage = (event) => {
    let message: { type?: string; kind?: string };
    try {
      message = JSON.parse(String(event.data)) as { type?: string; kind?: string };
    } catch {
      return;
    }
    if (message.type === 'ready') {
      retryMs = RETRY_MIN_MS;
      setConnected(true);
      // Kopukken kaçan olaylar bilinemez.
      for (const listener of listeners) listener({ type: 'resync' });
      return;
    }
    if (message.type === 'resync') {
      for (const listener of listeners) listener({ type: 'resync' });
    } else if (message.type === 'staff_notification' && typeof message.kind === 'string') {
      for (const listener of listeners) listener({ type: 'staff_notification', kind: message.kind });
    }
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    setConnected(false);
    scheduleRetry();
  };
}

function disconnect(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  retryMs = RETRY_MIN_MS;
  const ws = socket;
  socket = null;
  ws?.close();
  setConnected(false);
}

function wake(): void {
  if (document.hidden || socket !== null) return;
  paused = false;
  retryMs = RETRY_MIN_MS;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  void connect();
}

/** İlk abone bağlantıyı açar, son abone ayrılınca kapanır. */
export function subscribeRealtime(listener: Listener): () => void {
  if (listeners.size === 0) {
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
  }
  listeners.add(listener);
  void connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('online', wake);
    disconnect();
  };
}

export function isRealtimeConnected(): boolean {
  return connected;
}

export function onRealtimeStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}
