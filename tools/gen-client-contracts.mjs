#!/usr/bin/env node
/**
 * `packages/shared` sözleşmesinden native istemci sabitlerini üretir.
 *
 * NEDEN: iOS bu listeleri elle kopyaladı ve bir kez kaydı — Faz 6 finans izinleri
 * eksik kalınca ekranlar 403 bile vermeden, sessizce erişilemez oldu. Bir izin adının
 * yanlış yazılması `false` döndürür ve özellik hiç görünmez; fark edilmesi zor,
 * sebebi bulunması daha da zor bir hata sınıfı.
 *
 * Kullanım:
 *   pnpm gen:contracts           üretir
 *   pnpm gen:contracts --check   bayatsa 1 ile çıkar (CI kapısı)
 *
 * Gradle bunu ASLA çağırmaz — Android derlemesi node/pnpm'e bağımlı olmamalı.
 * Üretilen dosyalar commit edilir.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'klinara-android/app/src/main/java/com/klinara/android/services/contracts');
const CHECK = process.argv.includes('--check');

const SHARED_DIST = join(ROOT, 'packages/shared/dist/esm/index.js');
if (!existsSync(SHARED_DIST)) {
  console.error('@klinara/shared derlenmemiş. Önce: pnpm --filter @klinara/shared build');
  process.exit(1);
}

const shared = await import(SHARED_DIST);
const { ERROR_CODES, PERMISSIONS, ROLE_DEFINITIONS } = shared;

const BANNER = `// ÜRETİLMİŞTİR — ELLE DÜZENLEMEYİN.
//
// Kaynak: packages/shared/src/{error-codes,permissions}.ts
// Yeniden üretmek için: pnpm gen:contracts
//
// Bu dosyayı elle değiştirmek, sunucu sözleşmesiyle istemciyi sessizce ayrıştırır.
`;

/** camel/SCREAMING_SNAKE -> Kotlin sabit adı (zaten SCREAMING_SNAKE geliyor). */
function kotlinConst(key) {
  return key;
}

function renderErrorCodes() {
  const entries = Object.entries(ERROR_CODES);
  const cases = entries
    .map(([key, wire]) => `    ${kotlinConst(key)}("${wire}"),`)
    .join('\n');

  return `${BANNER}
package com.klinara.android.services.contracts

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * RFC 9457 yanıtlarındaki \`code\` alanı. İstemci BU değerlere göre dallanır;
 * \`title\`/\`detail\` insan içindir ve serbestçe değişebilir.
 *
 * Tanınmayan bir kod [UNKNOWN]'a düşer, çözümlemeyi KIRMAZ: sunucu yeni bir kod
 * eklediğinde eski istemciler çökmemeli, yalnız o kodu genel hata gibi göstermeli.
 */
@Serializable(with = ApiErrorCodeSerializer::class)
enum class ApiErrorCode(val wire: String) {
${cases}

    /** Sunucudan tanınmayan bir kod geldi. Sözleşmede yoktur, üretilmez. */
    UNKNOWN("UNKNOWN"),
    ;

    companion object {
        private val byWire = entries.associateBy(ApiErrorCode::wire)

        fun from(raw: String): ApiErrorCode = byWire[raw] ?: UNKNOWN
    }
}

/**
 * kotlinx.serialization'ın bilinmeyen enum değeri için yerleşik bir yedeği yok
 * (\`coerceInputValues\` yalnız *property* varsayılanıyla çalışır, değer düzeyinde
 * değil), bu yüzden özel serializer doğru mekanizmadır — geçici çözüm değil.
 */
object ApiErrorCodeSerializer : KSerializer<ApiErrorCode> {
    override val descriptor = PrimitiveSerialDescriptor("ApiErrorCode", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): ApiErrorCode = ApiErrorCode.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: ApiErrorCode,
    ) = encoder.encodeString(value.wire)
}
`;
}

function renderPermissions() {
  const consts = Object.entries(PERMISSIONS)
    .map(([key, value]) => `    const val ${kotlinConst(key)} = "${value}"`)
    .join('\n');

  const roles = ROLE_DEFINITIONS.map(
    (r) => `        "${r.key}" to "${r.name}",`,
  ).join('\n');

  const ranks = ROLE_DEFINITIONS.map(
    (r) => `            RoleDefinition("${r.key}", rank = ${r.rank}, scope = RoleScope.${r.scope[0].toUpperCase()}${r.scope.slice(1)}),`,
  ).join('\n');

  const bundles = ROLE_DEFINITIONS.map((r) => {
    const perms = r.permissions.map((p) => `                    "${p}",`).join('\n');
    return `            "${r.key}" to\n                listOf(\n${perms}\n                ),`;
  }).join('\n');

  return `${BANNER}
package com.klinara.android.services.contracts

/**
 * İzin anahtarları.
 *
 * **İstemci izni bir güvenlik sınırı DEĞİLDİR** — sunucu her uçta zaten kontrol
 * ediyor. Buradaki kontrol yalnız bir kullanılabilirlik kararıdır: yetkisi olmayana
 * düğmeyi gösterip içeride 403 vermek, ona yapamayacağı bir şeyi vaat etmektir.
 *
 * İzin adları elle yazılmaz, bu sabitlerden geçer: yanlış yazılan bir izin sessizce
 * \`false\` döner ve özellik hiç görünmez.
 */
object Permissions {
${consts}
}

/** Rol anahtarı → Türkçe görünen ad. Kiracı/şube seçim ekranlarında kullanılır. */
object RoleNames {
    private val byKey =
        mapOf(
${roles}
        )

    /** Bilinmeyen bir rol anahtarı olduğu gibi gösterilir — boş satır göstermekten iyidir. */
    fun turkish(roleKey: String): String = byKey[roleKey] ?: roleKey

    fun turkish(roleKeys: List<String>): String = roleKeys.joinToString(", ", transform = ::turkish)
}

enum class RoleScope { Platform, Tenant, Branch }

data class RoleDefinition(
    val key: String,
    /** Yetki genişliği: kimse kendinden yüksek rank'li bir rolü atayamaz/kaldıramaz. */
    val rank: Int,
    /** Tenant → şube ALMAZ; Branch → şube İSTER. */
    val scope: RoleScope,
)

/**
 * Rol tanımları — rank ve kapsam. Rol/şube düzenleyicisi (A7.5) sunucunun
 * \`assertNoEscalation\` ve \`assertRoleScope\` kurallarını bunlarla yansıtıyor.
 */
object RoleDefinitions {
    val all: List<RoleDefinition> =
        listOf(
${ranks}
        )

    fun of(roleKey: String): RoleDefinition? = all.firstOrNull { it.key == roleKey }
}

/**
 * Rol → izin demetleri.
 *
 * **Yalnız MOCK modu içindir.** Canlı modda izinler \`GET /me\` ile sunucudan gelir ve
 * tek doğruluk kaynağı odur.
 *
 * Buranın ÜRETİLMİŞ olması bir hata sınıfını kapatıyor: iOS aynı listeyi elle tutuyordu
 * ve Faz 6'nın finans izinleri hiç eklenmediği için mock modda kasa, prim ve cari hesap
 * ekranlarına ulaşılamıyordu — testin yakalayamadığı, yalnız elle gezerken görülen bir
 * kayıp. Artık \`permissions.ts\` değiştiğinde bu dosya da değişir ve CI bayat kalmasına
 * izin vermez.
 */
object RolePermissions {
    private val byRole: Map<String, List<String>> =
        mapOf(
${bundles}
        )

    fun forRole(roleKey: String): List<String> = byRole[roleKey].orEmpty()
}
`;
}

const outputs = [
  ['ApiErrorCode.kt', renderErrorCodes()],
  ['Permissions.kt', renderPermissions()],
];

await mkdir(OUT_DIR, { recursive: true });

let stale = false;
for (const [name, content] of outputs) {
  const path = join(OUT_DIR, name);
  const existing = existsSync(path) ? await readFile(path, 'utf8') : null;
  if (existing === content) {
    console.log(`= ${name} güncel`);
    continue;
  }
  stale = true;
  if (CHECK) {
    console.error(`! ${name} BAYAT — 'pnpm gen:contracts' çalıştırın ve commit edin.`);
  } else {
    await writeFile(path, content, 'utf8');
    console.log(`+ ${name} yazıldı`);
  }
}

if (CHECK && stale) process.exit(1);
console.log(
  `${Object.keys(ERROR_CODES).length} hata kodu, ${Object.keys(PERMISSIONS).length} izin, ${ROLE_DEFINITIONS.length} rol.`,
);
