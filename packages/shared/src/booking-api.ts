/**
 * Public randevu API'sinin yanıt sözleşmesi — sunucunun presenter'ı ile web
 * istemcisinin tek buluşma noktası.
 *
 * Bu tipler `apps/api/src/modules/public/*` içindeki view arayüzlerinin
 * aynadaki karşılığıdır. Kopyalanmış görünüyorlar ama kopya DEĞİLLER: sunucu
 * tarafında `PublicSiteView` presenter'ın çıktısını tarif eder, burada aynı
 * şekil istemcinin girdisi olarak durur ve `apps/api/test/unit/` altındaki
 * sözleşme testi ikisinin ayrışmasını derleme zamanında yakalar.
 */

import type { ContentBlock, PublicImage, Seo, Theme } from './booking-content.js';

/** RFC 9457 problem dokümanı — `ProblemDetailsFilter`'ın ürettiği gövde. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance: string;
  requestId: string;
  errors?: { path: string; message: string }[];
  [key: string]: unknown;
}

export interface PublicBranch {
  id: string;
  name: string;
  timezone: string;
  phone: string | null;
  address: string | null;
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  /** `showPrices=false` iken anahtar HİÇ YOKTUR — sıfır değil, yok. */
  priceMinor?: number;
  currency?: string;
}

export interface PublicCategory {
  id: string;
  name: string;
  services: PublicService[];
}

export interface RequiredConsent {
  kind: string;
  text: string;
  /** İstemci randevu oluştururken bunu aynen geri gönderir. */
  textSha256: string;
  required: boolean;
}

export interface PublicBookingSettings {
  minLeadMinutes: number;
  maxAdvanceDays: number;
  cancelWindowHours: number;
  holdTtlMinutes: number;
  showStaffSelection: boolean;
  showPrices: boolean;
  allowReschedule: boolean;
  requireOtp: boolean;
  otpChannel: string;
  requiredConsents: RequiredConsent[];
}

export interface PublicSitePayload {
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  locales: string[];
  defaultBranchId: string | null;
  /** `<link rel="canonical">`in kaynağı. Alan adı yoksa boş dize. */
  canonicalUrl: string;
  branches: PublicBranch[];
  theme: Theme;
  sections: ContentBlock[];
  seo: Seo;
  settings: PublicBookingSettings;
  revision: { number: number; contentHash: string };
}

export interface HostResolution {
  slug: string;
  canonicalUrl: string;
}

/** Personel seçimi — kimlik yerine opak `staffRef`. */
export interface StaffOption {
  staffRef: string;
  name: string;
  title: string | null;
  photo?: PublicImage | null;
}

export interface PublicSlot {
  startsAt: string;
  endsAt: string;
  /** Opak, imzalı slot temsili. UUID taşımaz. */
  slotToken: string;
  staffName?: string;
  staffRef?: string;
}

export interface PublicAvailability {
  timezone: string;
  slotGranularityMinutes: number;
  slots: PublicSlot[];
}

export interface HoldResponse {
  holdToken: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
  otpRequired: boolean;
  otpVerified: boolean;
}

export interface OtpRequestResponse {
  sentAt: string;
  expiresAt: string;
}

export interface CreateAppointmentResponse {
  appointmentId: string;
  manageToken: string;
}

export interface SelfServiceView {
  appointmentId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  serviceNames: string[];
  branchName: string;
  branchAddress: string | null;
  branchPhone: string | null;
  timezone: string;
  customerFirstName: string;
  canCancel: boolean;
  canReschedule: boolean;
  cancelWindowHours: number;
}
