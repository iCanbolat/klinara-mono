/**
 * Bildirim şablonları — panelin ve API'nin ortak sözleşmesi.
 *
 * Şablon gövdesi ham hâliyle `{{customerName}}` yer tutucuları taşır ve
 * istemcilerin bunu kendi kendine ayrıştırması bir hata kaynağıydı: her istemci
 * kendi etiket tablosunu tutuyor, biri güncellenip öteki unutulunca ekranlar
 * birbirinden ayrışıyordu. Bu yüzden gövde SUNUCUDA parçalara (`segments`)
 * ayrılır ve değişkenin okunur adı (`@HizmetAdı`) burada, tek yerde tanımlıdır.
 * İstemci yalnız parçaları sırayla çizer: `text` düz, `variable` mavi bağlantı
 * rengiyle.
 */

/** Gövdenin bir parçası. `variable`ın `handle`ı ekranda görünen `@Ad`dır. */
export type TemplateSegment =
  | { kind: 'text'; text: string }
  | { kind: 'variable'; name: string; handle: string };

/**
 * Değişken adı → ekranda görünen `@` etiketi.
 *
 * Etiket boşluksuz PascalCase: yazıldığı gibi tek bir ögedir, cümle içinde
 * kelime sanılmaz. Yeni bir değişken buraya eklenmeden şablona giremez —
 * `apps/api/test/unit/template-segments.test.ts` olay tanımlarındaki her adın
 * burada karşılığı olduğunu sabitliyor.
 */
export const TEMPLATE_VARIABLE_HANDLES: Readonly<Record<string, string>> = {
  customerName: '@MüşteriAdı',
  branchName: '@KlinikAdı',
  branchAddress: '@KlinikAdresi',
  appointmentAt: '@RandevuZamanı',
  serviceName: '@HizmetAdı',
  packageName: '@PaketAdı',
  remainingSessions: '@KalanSeans',
  expiresAt: '@SonKullanımTarihi',
  message: '@Mesaj',
  subject: '@Konu',
};

/** Tanımsız bir ad ham hâliyle (`@ad`) görünür — sessizce yutulmaz. */
export function variableHandle(name: string): string {
  return TEMPLATE_VARIABLE_HANDLES[name] ?? `@${name}`;
}

// Sunucudaki `template-renderer.ts` ile aynı desen: iki yerde ayrı yazılsaydı
// biri "geçerli" dediğini öteki metin sayardı.
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** `Merhaba {{customerName}}` → `[text "Merhaba ", variable @MüşteriAdı]`. */
export function templateSegments(body: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let cursor = 0;
  for (const match of body.matchAll(PLACEHOLDER)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: 'text', text: body.slice(cursor, start) });
    const name = match[1] as string;
    segments.push({ kind: 'variable', name, handle: variableHandle(name) });
    cursor = start + match[0].length;
  }
  if (cursor < body.length) segments.push({ kind: 'text', text: body.slice(cursor) });
  return segments;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export type NotificationChannel = 'whatsapp' | 'email' | 'push';

export type NotificationEvent =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'appointment_cancelled'
  | 'no_show_followup'
  | 'package_balance'
  | 'package_expiring'
  | 'auto_reply'
  | 'staff_reply'
  | 'staff_internal';

/** `NotificationTemplateResponseDto` — `GET /notification-templates` satırı. */
export interface NotificationTemplate {
  /** Kiracı satırı yoksa `null` — kod varsayılanı geçerli. */
  id: string | null;
  event: NotificationEvent;
  channel: NotificationChannel;
  locale: string;
  subject: string | null;
  body: string;
  whatsappTemplateName: string | null;
  whatsappTemplateLanguage: string | null;
  whatsappVariables: string[];
  isActive: boolean;
  isDefault: boolean;
  variables: string[];
  /** `body`nin parçalanmış hâli — ekranlar `body`yi değil bunu çizer. */
  segments: TemplateSegment[];
}

/** `UpsertNotificationTemplateDto` — panel yalnız `isActive`i değiştirir. */
export interface UpsertNotificationTemplateInput {
  event: NotificationEvent;
  channel: NotificationChannel;
  locale?: string;
  subject?: string;
  body: string;
  whatsappTemplateName?: string;
  whatsappTemplateLanguage?: string;
  whatsappVariables?: string[];
  isActive?: boolean;
}
