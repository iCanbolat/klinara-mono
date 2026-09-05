#!/usr/bin/env node
/*
 * Marka ikonlarını TEK kaynaktan üretir: `assets/brand/klinara-logo-source.png`.
 *
 * Elle kırpma/boyama yok — bu betik çalıştırıldığında iOS AppIcon'u, iOS
 * `LogoMark` asset'i ve web-admin'in favicon/marka görselleri yeniden yazılır.
 *
 *   node tools/brand/build-icons.mjs
 *
 * Kaynak logo düz iki renkli ve beyaz zeminli; her piksel `a·renk + (1−a)·beyaz`
 * karışımı olduğu için alfa geri hesaplanabiliyor. İşaret böylece şeffaf zemine
 * taşınıyor ve dark/tinted varyantlar için yeniden boyanabiliyor.
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = `${ROOT}/assets/brand/klinara-logo-source.png`;

/** Kaynaktaki işaretin sınır kutusu (kelime markası hariç), piksel. */
const MARK_BOX = { left: 388, top: 292, width: 250, height: 306 };
/** Kaynakta kullanılan iki renk. */
const SRC_SAGE = [127, 154, 118];
const SRC_CHAR = [46, 53, 50];

const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const bg = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), alpha: 1 });

/* iOS `Assets.xcassets` değerleri — tek otorite orası, burada kopyası duruyor. */
const LIGHT = { sage: rgb('#7F9A76'), char: rgb('#2E3532'), bg: bg('#FAF8F5') };
const DARK = { sage: rgb('#9DB894'), char: rgb('#F2EFEA'), bg: bg('#161917') };
/* tinted: sistem kendi rengini uyguluyor, uygulamadan gri tonlu maske bekleniyor. */
const TINTED = { sage: rgb('#B4B4B4'), char: rgb('#F0F0F0'), bg: bg('#1C1C1E') };

const raw = await sharp(SOURCE).extract(MARK_BOX).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { data, info } = raw;

/** Beyazla karışmış pikselden alfayı geri çöz: p = a·c + (1−a)·255. */
function unmix(p, c) {
  let num = 0, den = 0;
  for (let k = 0; k < 3; k++) {
    const w = 255 - c[k];
    num += w * (255 - p[k]);
    den += w * w;
  }
  const a = den === 0 ? 0 : Math.max(0, Math.min(1, num / den));
  let err = 0;
  for (let k = 0; k < 3; k++) err += (a * c[k] + (1 - a) * 255 - p[k]) ** 2;
  return { a, err };
}

async function render({ sage, char, bg: ground = null, size, pad = 0.16 }) {
  const n = info.width * info.height;
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const p = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    const s = unmix(p, SRC_SAGE);
    const c = unmix(p, SRC_CHAR);
    const hit = s.err <= c.err ? { a: s.a, t: sage } : { a: c.a, t: char };
    out[i * 4] = hit.t[0];
    out[i * 4 + 1] = hit.t[1];
    out[i * 4 + 2] = hit.t[2];
    // 0.02 altındaki alfa görünmez ama PNG'yi şişiriyor.
    out[i * 4 + 3] = hit.a < 0.02 ? 0 : Math.round(hit.a * 255);
  }
  const inner = Math.round(size * (1 - 2 * pad));
  const mark = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const canvas = { width: size, height: size, channels: 4, background: ground ?? { r: 0, g: 0, b: 0, alpha: 0 } };
  return sharp({ create: canvas }).composite([{ input: mark, gravity: 'centre' }]).png().toBuffer();
}

const IOS = `${ROOT}/klinara-ios/klinara-ios/Assets.xcassets`;
const WEB = `${ROOT}/apps/web-admin`;

const TARGETS = [
  // iOS uygulama ikonu — köşe yuvarlama YOK, sistem maskeliyor.
  [`${IOS}/AppIcon.appiconset/AppIcon-light.png`, { ...LIGHT, size: 1024 }],
  [`${IOS}/AppIcon.appiconset/AppIcon-dark.png`, { ...DARK, size: 1024 }],
  [`${IOS}/AppIcon.appiconset/AppIcon-tinted.png`, { ...TINTED, size: 1024 }],
  // iOS `LogoMark` — `KlinaraLogoMark` bu asset varsa vektör yedeği yerine onu kullanıyor.
  [`${IOS}/LogoMark.imageset/LogoMark.png`, { ...LIGHT, bg: null, size: 120, pad: 0.02 }],
  [`${IOS}/LogoMark.imageset/LogoMark@2x.png`, { ...LIGHT, bg: null, size: 240, pad: 0.02 }],
  [`${IOS}/LogoMark.imageset/LogoMark@3x.png`, { ...LIGHT, bg: null, size: 360, pad: 0.02 }],
  // web-admin
  [`${WEB}/public/brand/klinara-mark.png`, { ...LIGHT, bg: null, size: 360, pad: 0.02 }],
  [`${WEB}/src/app/icon.png`, { ...LIGHT, bg: null, size: 64, pad: 0.04 }],
  [`${WEB}/src/app/apple-icon.png`, { ...LIGHT, size: 180 }],
  // Ortak master
  [`${ROOT}/assets/brand/klinara-mark.png`, { ...LIGHT, bg: null, size: 1024, pad: 0.02 }],
];

for (const [file, opts] of TARGETS) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await render(opts));
  console.log('✓', file.replace(`${ROOT}/`, ''));
}
