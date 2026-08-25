import type { DestinationStream } from 'pino';

let testStream: DestinationStream | undefined;

/**
 * Log çıktısını yönlendirme kancası — YALNIZCA testler içindir.
 *
 * Testler gerçek gizleme (redaction) davranışını ölçebilsin diye var: logger
 * yapılandırması aynen korunur, sadece hedef değişir. Sahte bir logger ile
 * yapılan test, kuralların doğru yazıldığını değil yalnızca çağrının
 * yapıldığını kanıtlardı.
 */
export function setLogStream(stream: DestinationStream | undefined): void {
  testStream = stream;
}

export function getLogStream(): DestinationStream | undefined {
  return testStream;
}
