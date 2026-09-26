'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, FileImage, FileText, FolderOpen, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatBytes, formatDate } from '@/lib/customers/format';
import {
  ALLOWED_MIME_TYPES,
  cacheUntil,
  isAllowedType,
  isCacheValid,
  kindOf,
  shouldFallbackToOriginal,
} from '@/lib/customers/upload';
import { PanelSkeleton } from './panel-skeleton';

interface CustomerFile {
  id: string;
  kind: string;
  fileName: string | null;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface CachedUrl {
  url: string;
  until: number;
}

/**
 * Müşteri dosyaları.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ İNDİRME ADRESİ HER ÇAĞRIDA KVKK ERİŞİM KAYDI YAZIYOR
 * ---------------------------------------------------------------------------
 * `GET /files/:id/download-url` `customer_record_access_log`a satır atıyor.
 * Adres liste RENDER'INDA çekilseydi, bir liste kaydırması onlarca sahte
 * "görüntüledi" kaydı üretir ve erişim kaydının değerini SIFIRLARDI —
 * "kim hangi kaydı gördü" sorusu artık cevaplanamaz olurdu.
 *
 * Bu yüzden adres yalnız kullanıcı indirme EYLEMİNİ tetiklediğinde çekiliyor
 * ve sonuç `expiresAt`e kadar bellekte tutuluyor.
 *
 * ---------------------------------------------------------------------------
 * YÜKLEME ÜÇ AYAKLI VE ORTA AYAK PROXY'DEN GEÇMİYOR
 * ---------------------------------------------------------------------------
 * `presign` → tarayıcıdan DOĞRUDAN depolamaya `PUT` → `confirm`.
 * Gövdeyi Next üzerinden geçirmek 25 MB'lık bir dosyayı iki kez taşımak
 * olurdu. Bedeli: bu adım S3/MinIO'nun CORS ayarına bağlı ve ilk uçtan uca
 * geçişte doğrulanması gerekiyor (dokümanda açık madde).
 */
export function FilesPanel({
  customerId,
  canWrite,
}: {
  customerId: string;
  canWrite: boolean;
}): ReactNode {
  const [files, setFiles] = useState<CustomerFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Dosya kimliği → imzalı adres. Yeniden render adresi tekrar ÇEKMİYOR. */
  const urlCache = useRef<Map<string, CachedUrl>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const result = await api.get<{ data: CustomerFile[] }>(`customers/${customerId}/files`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setFiles(result.data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [customerId, nonce]);

  async function resolveUrl(fileId: string, variant: 'original' | 'thumb'): Promise<string> {
    const cached = urlCache.current.get(`${fileId}|${variant}`);
    if (cached !== undefined && isCacheValid(cached.until)) return cached.url;

    try {
      const result = await api.get<{ url: string; expiresAt: string }>(
        `files/${fileId}/download-url?variant=${variant}`,
      );
      urlCache.current.set(`${fileId}|${variant}`, {
        url: result.url,
        until: cacheUntil(result.expiresAt),
      });
      return result.url;
    } catch (caught) {
      // `thumb` hazır değilse sunucu 409 veriyor ve SESSİZCE tam boyuta
      // düşmüyor. İstemcinin doğru yanıtı kırık görsel göstermek değil.
      if (shouldFallbackToOriginal(caught, variant)) return resolveUrl(fileId, 'original');
      throw caught;
    }
  }

  async function download(fileId: string): Promise<void> {
    setBusy(fileId);
    setError(null);
    try {
      const url = await resolveUrl(fileId, 'original');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File): Promise<void> {
    if (!isAllowedType(file.type)) {
      // ÖNDEN denetim: kullanıcıya "sunucu reddetti" demek yerine dosya
      // seçerken söylemek gerek.
      setError(t('customers.files.typeRejected'));
      return;
    }

    setBusy('upload');
    setError(null);
    try {
      const presigned = await api.post<{
        storageKey: string;
        uploadUrl: string;
        contentType: string;
      }>('uploads/presign', {
        customerId,
        contentType: file.type,
        sizeBytes: file.size,
        kind: kindOf(file.type),
      });

      // Doğrudan depolamaya. `api` KULLANILMIYOR: bu adres proxy'nin
      // arkasında değil, imzalı ve harici.
      const put = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        // Sunucunun imzaladığı `Content-Type` AYNEN gönderilmeli; farklı bir
        // değer imzayı geçersiz kılar.
        headers: { 'content-type': presigned.contentType },
        body: file,
      });
      if (!put.ok) throw new Error(`Yükleme başarısız (${String(put.status)})`);

      await api.post(`customers/${customerId}/files`, {
        storageKey: presigned.storageKey,
        kind: kindOf(file.type),
      });

      toast.success(t('customers.files.uploaded'));
      setNonce((value) => value + 1);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  }

  async function remove(fileId: string): Promise<void> {
    setBusy(fileId);
    setError(null);
    try {
      await api.delete(`files/${fileId}`);
      urlCache.current.delete(`${fileId}|original`);
      urlCache.current.delete(`${fileId}|thumb`);
      setNonce((value) => value + 1);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const uploading = busy === 'upload';
  const pickFile = (): void => inputRef.current?.click();

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      {canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t('customers.files.accepted')}</p>
          {/* Yerel giriş görünmez; tarayıcının "Dosya Seç / seçilmedi" metni
              arayüzle uyumsuz ve çevrilemiyor. Erişilebilir adı korunuyor. */}
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_MIME_TYPES.join(',')}
            aria-label={t('customers.files.upload')}
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void upload(file);
            }}
            className="sr-only"
            tabIndex={-1}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={uploading}
            disabled={busy !== null}
            onClick={pickFile}
          >
            <Upload aria-hidden="true" />
            {uploading ? t('customers.files.uploading') : t('customers.files.upload')}
          </Button>
        </div>
      ) : null}

      {files === null && error === null ? <PanelSkeleton /> : null}

      {files !== null && files.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={t('customers.files.empty')}
          message={t(canWrite ? 'customers.files.emptyHint' : 'customers.files.emptyReadOnly')}
          className="py-10"
        />
      ) : null}

      {files !== null && files.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {files.map((file) => {
            const document = file.mimeType === 'application/pdf';
            const Icon = document ? FileText : FileImage;
            return (
              <li key={file.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-body-emphasis text-foreground">
                    {file.fileName ?? file.mimeType}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {[
                      t(document ? 'customers.files.document' : 'customers.files.photo'),
                      formatBytes(file.sizeBytes),
                      formatDate(file.createdAt),
                    ].join(' · ')}
                  </span>
                </div>
                <span className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t('customers.files.download')}: ${file.fileName ?? file.mimeType}`}
                    title={t('customers.files.download')}
                    loading={busy === file.id}
                    disabled={busy !== null}
                    onClick={() => void download(file.id)}
                  >
                    <Download aria-hidden="true" />
                  </Button>
                  {canWrite ? (
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('customers.files.delete')}: ${file.fileName ?? file.mimeType}`}
                      disabled={busy !== null}
                      title={t('customers.files.delete')}
                      description={file.fileName ?? file.mimeType}
                      destructive
                      onConfirm={() => void remove(file.id)}
                    >
                      <Trash2 aria-hidden="true" className="text-destructive" />
                    </ConfirmButton>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
