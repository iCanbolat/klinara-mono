import 'reflect-metadata';
import { applyTestEnv } from './env';

/**
 * Vitest `setupFiles` kancası: her test dosyasından ÖNCE geçerli bir temel
 * ortam kurar. Testler kendi değerlerini `createTestApp({ env })` ile
 * üzerine yazar.
 */
applyTestEnv();
