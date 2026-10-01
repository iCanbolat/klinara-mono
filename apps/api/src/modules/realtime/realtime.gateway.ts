import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PERMISSIONS } from '@klinara/shared';
import { PinoLogger } from 'nestjs-pino';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { emptyContext, runWithRequestContext } from '../../common/request-context';
import { RealtimeBusService, type RealtimeEvent } from '../../lib/realtime/realtime-bus.service';
import { canAccessBranch, hasPermission, type Principal } from '../identity/principal';
import { PrincipalService } from '../identity/principal.service';
import { TokenService } from '../identity/token.service';

/** `configureApp`teki `API_PREFIX` ile aynı kök; soket Express'ten geçmiyor. */
export const REALTIME_PATH = '/api/v1/realtime';

/** Bağlandıktan sonra bilet bu sürede gelmezse soket kapanır. */
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
/** Oturum/yetki bu aralıkla yeniden doğrulanır — çıkış yapan kullanıcı düşer. */
const REVALIDATE_MS = 60_000;
/** İstemciden yalnız küçük bir `auth` mesajı beklenir. */
const MAX_PAYLOAD_BYTES = 4 * 1024;

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

interface Connection {
  socket: WebSocket;
  alive: boolean;
  principal: Principal | null;
  validatedAt: number;
}

/**
 * Panelin anlık olay kanalı.
 *
 * TEK YÖNLÜ ve İÇERİKSİZ: sunucu "yeni bildirim var" der, istemci veriyi
 * yetkili REST ucundan (`GET staff-notifications`) okur. Soketten veri
 * taşınmadığı için yetki denetimi iki yerde tekrarlanmıyor.
 *
 * KİMLİK: el sıkışmada cookie ya da `Authorization` okunmaz. İstemci önce
 * `POST realtime/ticket` ile kısa ömürlü bir bilet alır ve bağlandıktan sonra
 * İLK mesajda gönderir. Bilet URL'de taşınmıyor ki erişim loglarına düşmesin;
 * kimlik cookie'ye dayanmadığı için `Origin` denetimine de gerek kalmıyor
 * (siteler arası soket ele geçirme, tarayıcının kendiliğinden eklediği bir
 * kimlik gerektirir).
 */
@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  private readonly connections = new Set<Connection>();
  private readonly byTenant = new Map<string, Set<Connection>>();
  private heartbeat: NodeJS.Timeout | undefined;
  private httpServer: Server | undefined;
  private unsubscribe: (() => void)[] = [];

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly bus: RealtimeBusService,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalService,
    private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.httpServer = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.httpServer.on('upgrade', this.onUpgrade);
    this.server.on('connection', (socket) => this.accept(socket));

    this.unsubscribe = [
      this.bus.onEvent((event) => this.broadcast(event)),
      this.bus.onResync(() => this.sendAll({ type: 'resync' })),
    ];

    this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /**
   * HTTP sunucusu kapanmadan ÖNCE: açık soketler `server.close()`u süresiz
   * bekletir ve zarif kapanış watchdog'a düşerdi.
   */
  beforeApplicationShutdown(): void {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    for (const off of this.unsubscribe) off();
    this.httpServer?.off('upgrade', this.onUpgrade);
    for (const connection of this.connections) connection.socket.close(1001);
    this.server.close();
    // Kapanış el sıkışmasını tamamlamayan istemci süreci tutmasın.
    const stragglers = setTimeout(() => {
      for (const connection of this.connections) connection.socket.terminate();
    }, 1_000);
    stragglers.unref();
  }

  private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== REALTIME_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    this.server.handleUpgrade(request, socket, head, (ws) => {
      this.server.emit('connection', ws, request);
    });
  };

  private accept(socket: WebSocket): void {
    const connection: Connection = { socket, alive: true, principal: null, validatedAt: 0 };
    this.connections.add(connection);

    const authTimer = setTimeout(() => {
      if (connection.principal === null) socket.close(CLOSE_UNAUTHENTICATED);
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();

    socket.on('pong', () => {
      connection.alive = true;
    });
    // Dinleyici yoksa bozuk bir çerçeve süreci düşürür.
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearTimeout(authTimer);
      this.drop(connection);
    });
    socket.on('message', (data, isBinary) => {
      // Kimlik bir kez kurulur; sonrasında istemciden gelen her şey yok sayılır.
      if (isBinary || connection.principal !== null) return;
      void this.authenticate(connection, textOf(data));
    });
  }

  private async authenticate(connection: Connection, raw: string): Promise<void> {
    try {
      const message = JSON.parse(raw) as { type?: unknown; ticket?: unknown };
      if (message.type !== 'auth' || typeof message.ticket !== 'string') {
        connection.socket.close(CLOSE_UNAUTHENTICATED);
        return;
      }
      const claims = await this.tokens.verify(message.ticket, 'realtime');
      if (claims.tid === undefined || claims.sid === undefined) {
        connection.socket.close(CLOSE_UNAUTHENTICATED);
        return;
      }
      const principal = await this.resolve({
        userId: claims.sub,
        tenantId: claims.tid,
        sessionId: claims.sid,
        tokenVersion: claims.tv,
      });
      if (!hasPermission(principal, PERMISSIONS.NOTIFICATION_READ)) {
        connection.socket.close(CLOSE_FORBIDDEN);
        return;
      }
      // Doğrulama sürerken soket kapanmış ya da başka bir `auth` kazanmış olabilir.
      if (connection.socket.readyState !== WebSocket.OPEN || connection.principal !== null) return;

      connection.principal = principal;
      connection.validatedAt = Date.now();
      let tenant = this.byTenant.get(principal.tenantId);
      if (tenant === undefined) {
        tenant = new Set();
        this.byTenant.set(principal.tenantId, tenant);
      }
      tenant.add(connection);
      this.send(connection, { type: 'ready' });
    } catch {
      connection.socket.close(CLOSE_UNAUTHENTICATED);
    }
  }

  /** `AuthGuard` ile AYNI çözümleme: oturum, token sürümü, üyelik. */
  private resolve(input: {
    userId: string;
    tenantId: string;
    sessionId: string;
    tokenVersion: number;
  }): Promise<Principal> {
    // Soketin istek bağlamı yok; `TenantTxService.run` kiracıyı oradan okuyor.
    const ctx = {
      ...emptyContext(),
      tenantId: input.tenantId,
      userId: input.userId,
      sessionId: input.sessionId,
    };
    return runWithRequestContext(ctx, () => this.principals.resolve(input));
  }

  private broadcast(event: RealtimeEvent): void {
    const tenant = this.byTenant.get(event.tenantId);
    if (tenant === undefined) return;
    for (const connection of tenant) {
      const principal = connection.principal;
      if (principal === null) continue;
      if (event.branchId !== null && !canAccessBranch(principal, event.branchId)) continue;
      this.send(connection, { type: event.type, kind: event.kind });
    }
  }

  private sendAll(message: object): void {
    for (const connection of this.connections) {
      if (connection.principal !== null) this.send(connection, message);
    }
  }

  private send(connection: Connection, message: object): void {
    if (connection.socket.readyState !== WebSocket.OPEN) return;
    connection.socket.send(JSON.stringify(message));
  }

  private tick(): void {
    const now = Date.now();
    for (const connection of this.connections) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();

      if (connection.principal !== null && now - connection.validatedAt >= REVALIDATE_MS) {
        connection.validatedAt = now;
        void this.revalidate(connection, connection.principal);
      }
    }
  }

  /** Çıkış, parola değişimi ya da yetkinin alınması açık soketi de düşürür. */
  private async revalidate(connection: Connection, current: Principal): Promise<void> {
    try {
      const principal = await this.resolve(current);
      if (!hasPermission(principal, PERMISSIONS.NOTIFICATION_READ)) {
        connection.socket.close(CLOSE_FORBIDDEN);
        return;
      }
      // Şube üyeliği değişmiş olabilir; süzgeç güncel kimlikle çalışsın.
      if (connection.principal !== null) connection.principal = principal;
    } catch (error: unknown) {
      this.logger.debug({ err: error }, 'Yayın soketi yeniden doğrulanamadı');
      connection.socket.close(CLOSE_UNAUTHENTICATED);
    }
  }

  private drop(connection: Connection): void {
    this.connections.delete(connection);
    const tenantId = connection.principal?.tenantId;
    if (tenantId === undefined) return;
    const tenant = this.byTenant.get(tenantId);
    if (tenant === undefined) return;
    tenant.delete(connection);
    if (tenant.size === 0) this.byTenant.delete(tenantId);
  }
}
