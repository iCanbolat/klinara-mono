'use client';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { OtpInput } from '@/components/ui/otp-input';
import { isCompletePhone, PhoneInput } from '@/components/ui/phone-input';
import { t } from '@/i18n/tr';

export function IdentityStep({
  phone,
  onPhoneChange,
  otpSent,
  otpCode,
  onOtpChange,
  onSend,
  onVerify,
  sending,
  verifying,
  lockedSeconds,
}: {
  /** Ulusal haneler; E.164'e çevirmek çağıranın işi. */
  phone: string;
  onPhoneChange: (digits: string) => void;
  otpSent: boolean;
  otpCode: string;
  onOtpChange: (code: string) => void;
  onSend: () => void;
  onVerify: () => void;
  sending: boolean;
  verifying: boolean;
  lockedSeconds: number | null;
}) {
  return (
    <div className="space-y-5">
      <Field id="phone" label={t('booking.identity.phone')}>
        <PhoneInput id="phone" value={phone} onChange={onPhoneChange} disabled={otpSent} />
      </Field>

      {!otpSent ? (
        <Button
          type="button"
          size="lg"
          className="w-full sm:w-auto"
          loading={sending}
          disabled={!isCompletePhone(phone)}
          onClick={onSend}
        >
          {t('booking.identity.send')}
        </Button>
      ) : (
        <div className="animate-step-in space-y-4">
          <p className="text-sm opacity-70" role="status">
            {t('booking.identity.sentTo', { phone: `+90 ${phone.slice(0, 3)} ••• •• ${phone.slice(8)}` })}
          </p>

          <div className="space-y-2">
            <span className="block text-sm font-medium">{t('booking.otp.label')}</span>
            <OtpInput
              value={otpCode}
              onChange={onOtpChange}
              disabled={lockedSeconds !== null}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              loading={verifying}
              disabled={otpCode.length < 6 || lockedSeconds !== null}
              onClick={onVerify}
            >
              {t('booking.identity.verify')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={sending || lockedSeconds !== null}
              onClick={() => {
                onOtpChange('');
                onSend();
              }}
            >
              {t('booking.identity.resend')}
            </Button>
          </div>

          {lockedSeconds !== null && (
            <p className="text-xs opacity-70">
              {t('booking.identity.locked', { seconds: lockedSeconds })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
