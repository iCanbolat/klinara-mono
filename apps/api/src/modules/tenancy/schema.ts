import { z } from 'zod';

const slug = z
  .string()
  .min(3)
  .max(50)
  .regex(
    /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/,
    'Yalnız küçük harf, rakam ve tire; tire ile başlayamaz/bitemez',
  );

const timezone = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Geçerli bir IANA saat dilimi olmalı (ör. Europe/Istanbul)' },
);

export const TenantResponse = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['trial', 'active', 'suspended']),
  timezone: z.string(),
  currency: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const CreateTenantBody = z.object({
  slug,
  name: z.string().min(1).max(200),
  timezone: timezone.default('Europe/Istanbul'),
  currency: z.string().length(3).default('TRY'),
  /** İlk şube kiracıyla birlikte oluşturulur — şubesiz kiracı iş göremez. */
  branch: z.object({
    slug,
    name: z.string().min(1).max(200),
    timezone: timezone.optional(),
  }),
});

export const UpdateTenantBody = z
  .object({
    name: z.string().min(1).max(200),
    timezone,
    status: z.enum(['trial', 'active', 'suspended']),
  })
  .partial();

export const BranchResponse = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const CreateBranchBody = z.object({
  slug,
  name: z.string().min(1).max(200),
  timezone: timezone.optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(500).optional(),
});

export const UpdateBranchBody = z
  .object({
    name: z.string().min(1).max(200),
    timezone,
    phone: z.string().max(30).nullable(),
    address: z.string().max(500).nullable(),
    isActive: z.boolean(),
  })
  .partial();

export const TenantSettingsResponse = z.object({
  slotGranularityMinutes: z.number().int(),
  preventCustomerDoubleBooking: z.boolean(),
  reminderHoursBefore: z.array(z.number().int()),
  cancelWindowHours: z.number().int(),
});
