import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Permission } from '@klinara/shared';
import {
  ANY_PERMISSIONS_KEY,
  BRANCH_SCOPE_KEY,
  EDGE_ONLY_KEY,
  PERMISSIONS_KEY,
  PLATFORM_ADMIN_KEY,
  PUBLIC_KEY,
  SELF_SERVICE_KEY,
} from '../../src/common/decorators/auth.decorators';

/**
 * Bir ucun kapısını NE'nin tuttuğu.
 *
 * `unguarded` kasıtlı olarak vardır: guard çalışma zamanında fail-closed
 * davranıyor (izinsiz uç 403 veriyor) ama bu, hatanın ancak biri o ucu
 * çağırdığında görülmesi demek. Envanter aynı soruyu DERLEME sonrası, tek
 * seferde ve istek göndermeden sorar.
 */
export type RouteGuardKind =
  | 'public'
  | 'selfService'
  | 'platformAdmin'
  | 'edgeOnly'
  | 'permission'
  | 'anyPermission'
  | 'unguarded';

export interface RouteInfo {
  /** `GET /customers/:id` — controller ve handler yolundan birleştirilmiş. */
  signature: string;
  controller: string;
  handler: string;
  kind: RouteGuardKind;
  permissions: Permission[];
  requiresBranchScope: boolean;
}

/**
 * Uygulamada KAYITLI tüm HTTP uçlarını, yetki metadata'sıyla birlikte döker.
 *
 * Kaynağı Express router'ı değil Nest'in modül konteyneridir: router yalnız
 * yolları bilir, hangi dekoratörün hangi handler'a bağlandığını bilmez.
 * `Reflector.getAllAndOverride` ile okumak da bilinçli — `PermissionsGuard`
 * metadata'yı aynen böyle okur, yani envanter guard'ın gördüğünü görür
 * (handler, sınıfı EZER).
 */
export function collectRoutes(app: INestApplication): RouteInfo[] {
  const modules = app.get(ModulesContainer);
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];

  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (controller == null) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      const basePath = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';

      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name] as (...args: unknown[]) => unknown;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;

        const targets = [handler, controller];
        const flag = (key: string): boolean =>
          reflector.getAllAndOverride<boolean>(key, targets) === true;
        const all = reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
        const any = reflector.getAllAndOverride<Permission[]>(ANY_PERMISSIONS_KEY, targets) ?? [];

        let kind: RouteGuardKind = 'unguarded';
        let permissions: Permission[] = [];
        if (flag(PUBLIC_KEY)) kind = 'public';
        else if (flag(PLATFORM_ADMIN_KEY)) kind = 'platformAdmin';
        else if (flag(EDGE_ONLY_KEY)) kind = 'edgeOnly';
        else if (any.length > 0) {
          kind = 'anyPermission';
          permissions = any;
        } else if (all.length > 0) {
          kind = 'permission';
          permissions = all;
        } else if (flag(SELF_SERVICE_KEY)) kind = 'selfService';

        routes.push({
          signature: `${RequestMethod[method]} /${basePath}/${path}`.replace(/\/{2,}/g, '/'),
          controller: controller.name,
          handler: name,
          kind,
          permissions,
          requiresBranchScope: flag(BRANCH_SCOPE_KEY),
        });
      }
    }
  }

  return routes.sort((a, b) => a.signature.localeCompare(b.signature));
}
