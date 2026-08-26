import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';

/** `Algorithm.Argon2id` — bkz. constructor'daki not. */
const ARGON2_ID = 2 as Algorithm;

/**
 * Parola hash'leme — argon2id.
 *
 * Parametreler env'den gelir ve varsayılanları OWASP'ın önerisidir
 * (m=19456 KiB, t=2, p=1). Bellek maliyeti GPU paralelliğini sınırlar; bcrypt'in
 * yapamadığı şey budur ve seçimin tek sebebi de odur.
 *
 * `verify` argon2 kodlanmış hash'in kendi parametrelerini kullanır: env
 * değerleri sertleştirildiğinde eski hash'ler doğrulanmaya devam eder.
 */
@Injectable()
export class PasswordService {
  private readonly options: {
    algorithm: Algorithm;
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.options = {
      // `Algorithm.Argon2id` bir ambient const enum; `isolatedModules` altında
      // çalışma zamanında erişilemez, bu yüzden değeri doğrudan yazıyoruz.
      algorithm: ARGON2_ID,
      memoryCost: config.get('ARGON2_MEMORY_COST', { infer: true }),
      timeCost: config.get('ARGON2_TIME_COST', { infer: true }),
      parallelism: config.get('ARGON2_PARALLELISM', { infer: true }),
    };
  }

  hash(plain: string): Promise<string> {
    return hash(plain, this.options);
  }

  /**
   * Parolayı doğrular. Hash bozuksa `false` döner — istisna FIRLATMAZ, çünkü
   * çağıran taraf için "doğrulanamadı" ile "hash bozuk" aynı sonuca çıkar ve
   * ayrım hata mesajından sızabilir.
   */
  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain, this.options);
    } catch {
      return false;
    }
  }

  /**
   * Kullanıcı yokken de aynı süreyi harcamak için sahte doğrulama.
   *
   * Olmasaydı yanıt süresi "bu e-posta kayıtlı mı?" sorusunu cevaplardı:
   * kayıtlı kullanıcıda argon2 çalışır (~50 ms), kayıtsızda anında dönerdi.
   * Kullanıcı sayımı (account enumeration) tam olarak böyle yapılır.
   */
  async fakeVerify(): Promise<void> {
    await hash('klinara-zamanlama-dengeleyici', this.options);
  }
}
