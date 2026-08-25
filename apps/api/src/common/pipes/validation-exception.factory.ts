import type { ValidationError } from 'class-validator';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../errors/app-error';

export interface FieldIssue {
  path: string;
  message: string;
}

/** İç içe DTO hatalarını `branch.slug` gibi noktalı yollara düzleştirir. */
function flatten(errors: ValidationError[], prefix = ''): FieldIssue[] {
  return errors.flatMap((error) => {
    const path = prefix === '' ? error.property : `${prefix}.${error.property}`;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ path, message }));
    const nested = error.children !== undefined ? flatten(error.children, path) : [];
    return [...own, ...nested];
  });
}

/**
 * `ValidationPipe`in ürettiği hataları RFC 9457 gövdesine uygun bir
 * `AppError`e çevirir. Varsayılan Nest yanıtı (`{ message: string[] }`)
 * hata sözleşmemize uymaz: istemci alan bazlı hataları `errors[].path`
 * üzerinden okur.
 */
export function validationExceptionFactory(errors: ValidationError[]): AppError {
  return new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Gönderilen veri geçersiz', {
    extra: { errors: flatten(errors) },
  });
}
