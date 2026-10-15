'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';

/**
 * Platform girişi: `PLATFORM_ADMIN_TOKEN` + destek gerekçesi.
 *
 * Gerekçe API'deki erişim kaydına (`platform_access_log`) her çağrıyla
 * birlikte yazılır; "kurulum: Lale Klinik" gibi bir metin yeterli.
 */
export default function PlatformLoginPage(): ReactNode {
  const [token, setToken] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/platform-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, reason }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { title?: string };
        setError(body.title ?? 'Giriş başarısız');
        return;
      }
      window.location.assign('/platform');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-sm">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Platform yönetimi</CardTitle>
            <CardDescription>
              Klinik kurulumu ve plan yönetimi. Oturum 8 saat sürer.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
            <Field
              label="Platform anahtarı"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
            <Field
              label="Erişim gerekçesi"
              hint="Erişim kaydına yazılır. En az 8 karakter."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="ör. Lale Klinik kurulumu"
              minLength={8}
              required
            />
            {error === null ? null : <Alert tone="danger">{error}</Alert>}
            <Button type="submit" loading={busy}>
              Giriş yap
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
