import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * `{{degisken}}` yerine koyma.
 *
 * Tanımsız değişken SESSİZCE BOŞ BIRAKILMAZ, hata verir. Sebebi somut:
 * "Sayın , yarınki randevunuz  saatinde" gibi bir mesaj müşteriye gittiğinde
 * geri alınamaz. Hata, mesaj daha kuyruğa girmeden şablonu yazan kişiye döner.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  const missing: string[] = [];
  const rendered = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      missing.push(name);
      return '';
    }
    return value;
  });

  if (missing.length > 0) {
    throw new AppError(
      422,
      ERROR_CODES.TEMPLATE_INVALID,
      `Şablonda karşılığı olmayan değişken: ${[...new Set(missing)].join(', ')}`,
    );
  }
  return rendered;
}

/** Şablonun kullandığı değişken adları — doğrulama ve `/docs` için. */
export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string))];
}
