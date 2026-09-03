'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BLOCK_TYPES,
  ERROR_CODES,
  resolveAssets,
  type BlockType,
  type BookingPage,
  type BookingPageContent,
  type Branch,
  type ContentBlockInput,
  type PublicImage,
  type PublicSitePayload,
  type SeoInput,
  type ThemeInput,
} from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { bookingPageAccess } from '@/lib/permissions';
import { moveBlock, removeBlock, replaceBlock } from '@/lib/editor/move-block';
import { BLOCK_LABEL_KEY, emptyBlock } from '@/lib/editor/block-schema';
import { validateSections, validateSeo } from '@/lib/editor/validate';
import { clearDraft, readDraft, saveDraft, shouldRestore } from '@/lib/editor/draft-recovery';
import { useAssetLibrary } from '@/lib/editor/use-asset-library';
import { useSession } from '@/components/session/session-provider';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { BlockList } from './block-list';
import { BlockForm } from './block-form';
import { PublishBar } from './publish-bar';
import { PreviewFrame } from './preview-frame';
import { ThemePanel } from './theme-panel';

type Tab = 'content' | 'theme' | 'seo';

/** Batch 11.5 — içerik ve tema editörü. */
export function ContentEditor(): ReactNode {
  const { permissions } = useSession();
  const access = bookingPageAccess(permissions);
  const readOnly = access !== 'full';

  const [page, setPage] = useState<BookingPage | null>(null);
  const [content, setContent] = useState<BookingPageContent | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [sections, setSections] = useState<ContentBlockInput[]>([]);
  const [theme, setTheme] = useState<ThemeInput>({});
  const [seo, setSeo] = useState<SeoInput>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('content');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [previewBase, setPreviewBase] = useState<PublicSitePayload | null>(null);
  const [preview, setPreview] = useState<unknown>(null);
  const library = useAssetLibrary();

  const errors = useMemo(
    () => [...validateSections(sections), ...validateSeo(seo)],
    [sections, seo],
  );

  const load = useCallback(async () => {
    try {
      const [loadedPage, loadedContent, loadedBranches] = await Promise.all([
        api.get<BookingPage>('booking-page'),
        api.get<BookingPageContent>('booking-page/content'),
        api.get<Branch[]>('branches'),
      ]);
      setPage(loadedPage);
      setContent(loadedContent);
      setBranches(loadedBranches);
      setSections(loadedContent.sections);
      setTheme(loadedContent.theme);
      setSeo(loadedContent.seo);
      setDirty(false);

      // Oturum çok adımlı yeniden girişle kesildiyse taslak diskte olabilir.
      const stored = readDraft(loadedPage.id);
      if (shouldRestore(stored, loadedContent.draft?.contentHash ?? null) && stored !== null) {
        setSections(stored.document.sections);
        setTheme(stored.document.theme ?? {});
        setSeo(stored.document.seo ?? {});
        setDirty(true);
        setRestored(true);
      }
    } catch (caught) {
      setError(toMessage(caught));
    }
  }, []);

  useEffect(() => {
    // Efekt gövdesinde `void load()` çağırmak, lint için setState'i SENKRON
    // çağırmak sayılıyor (`react-hooks/set-state-in-effect`). Async sarmalayıcı
    // durum güncellemesini promise geri çağrısına taşıyor.
    void (async () => {
      await load();
    })();
  }, [load]);

  /**
   * Kaydedilmemiş içerik sürekli diske yazılıyor.
   *
   * Oturum modal içinde kurtarıldığında bu gereksiz (ağaç hiç unmount olmuyor);
   * ama kiracı seçimi ya da MFA gerektiren bir yeniden giriş tam sayfa gezinme
   * demek ve orada React durumu ölüyor.
   */
  useEffect(() => {
    if (page === null || !dirty) return;
    saveDraft(page.id, {
      document: { theme, sections, seo },
      baseContentHash: content?.draft?.contentHash ?? null,
      savedAt: Date.now(),
    });
  }, [page, dirty, theme, sections, seo, content]);

  /**
   * Önizlemenin TABANI — sunucudan gelen tam görünüm.
   *
   * İçeriğin kendisi değil, onu saran her şey: şubeler, çözülmüş ayarlar, para
   * birimi, kanonik adres. Bunlar editörde düzenlenmiyor, dolayısıyla her tuş
   * vuruşunda yeniden okunmaları gerekmiyor — yalnız yükleme, kaydetme ve geri
   * almadan sonra tazeleniyor. Sayfa hiç kaydedilmemişse uç BOŞ bir görünüm
   * dönüyor (404 değil), yani önizleme ilk tuş vuruşundan itibaren çalışıyor.
   */
  const refreshPreview = useCallback(async () => {
    try {
      setPreviewBase(await api.get<PublicSitePayload>('booking-page/preview'));
    } catch {
      // Önizleme bir kolaylık; başarısızlığı editörü durdurmamalı.
    }
  }, []);

  useEffect(() => {
    if (page === null) return;
    void (async () => {
      await refreshPreview();
    })();
  }, [page, refreshPreview]);

  /**
   * Varlık kimliği → görsel dizini.
   *
   * Sunucunun `buildAssetIndex`inin istemci karşılığı; adresi kendimiz kurmuyoruz
   * çünkü `Asset.url` zaten imzasız ve değişmez.
   */
  const assetIndex = useMemo(() => {
    const index = new Map<string, PublicImage>();
    for (const asset of library.assets) {
      index.set(asset.id, {
        url: asset.url,
        alt: asset.altText,
        width: asset.width,
        height: asset.height,
      });
    }
    return index;
  }, [library.assets]);

  /**
   * CANLI önizleme yükü — KAYDEDİLMEMİŞ doküman dahil.
   *
   * Taban sunucudan, içerik editörün belleğinden. Dönüşümü yapan `resolveAssets`
   * `@klinara/shared`te ve public yanıtı üreten sunucu kodunun TA KENDİSİ:
   * ikinci bir kopya, bir gün yeni bir `*AssetId` alanını biri tanıyıp öbürünün
   * tanımaması demekti ve fark tam olarak önizlemenin var olma sebebini
   * çürüterek ortaya çıkardı.
   *
   * `revision` taşınmıyor — taban neyse o kalıyor: bu alan yayınlanmış sürümü
   * tarif ediyor ve kaydedilmemiş bir taslağın sürüm numarası yok.
   */
  const livePreview = useMemo(() => {
    if (previewBase === null) return null;
    return {
      site: {
        ...previewBase,
        theme: resolveAssets(theme, assetIndex),
        sections: resolveAssets(sections, assetIndex),
        seo: resolveAssets(seo, assetIndex),
      },
      categories: [],
    };
  }, [previewBase, theme, sections, seo, assetIndex]);

  /**
   * Yükü GECİKTİREREK yayınla.
   *
   * Her tuş vuruşu iframe'in React ağacını yeniden render ederdi; başlığa
   * yazarken önizlemenin takılması, canlı önizlemenin kazandırdığından fazlasını
   * götürürdü. 200 ms yazmayı takip edecek kadar hızlı, her karakteri bir
   * render'a çevirmeyecek kadar yavaş.
   */
  useEffect(() => {
    const timer = setTimeout(() => setPreview(livePreview), 200);
    return () => clearTimeout(timer);
  }, [livePreview]);

  function mutate(next: () => void): void {
    next();
    setDirty(true);
  }

  /**
   * Taslağı kaydeder. Başarılıysa `true`.
   *
   * ÇAKIŞMAYI SUNUCU SÖYLÜYOR. `PUT /booking-page/content` artık `If-Match`
   * zorunlu tutuyor ve taslak işaretçisini kilit altında taşıyor; yani
   * "kaydetmeden önce sürümü yeniden oku" turunun bıraktığı TOCTOU penceresi
   * kapandı. İstemcinin tek işi elindeki sürümü göndermek ve 409'u tanımak.
   *
   * `force` = kullanıcı "üzerine yaz" dedi: YÜRÜRLÜKTEKİ sürümü okuyup onu
   * `If-Match` yapıyoruz. Kilidi büsbütün atlamıyoruz — araya bir üçüncü
   * kaydetme girerse yine 409 alınır ve diyalog tekrar açılır.
   */
  async function save(force = false): Promise<boolean> {
    if (page === null) return false;
    setSaving(true);
    setError(null);
    try {
      const expected = force
        ? ((await api.get<BookingPageContent>('booking-page/content')).draft?.revisionNumber ?? 0)
        : (content?.draft?.revisionNumber ?? 0);

      const saved = await api.put<BookingPageContent>(
        'booking-page/content',
        { theme, sections, seo },
        { ifMatch: `W/"${String(expected)}"` },
      );
      setContent(saved);
      setDirty(false);
      setConflict(false);
      clearDraft(page.id);
      setPage(await api.get<BookingPage>('booking-page'));
      await refreshPreview();
      return true;
    } catch (caught) {
      if (caught instanceof ApiProblemError && caught.code === ERROR_CODES.VERSION_CONFLICT) {
        setConflict(true);
        return false;
      }
      setError(toMessage(caught));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish(): Promise<void> {
    setPublishing(true);
    setError(null);
    try {
      // Kaydetme çakışmayla düştüyse YAYINLAMIYORUZ: aksi hâlde kullanıcının
      // ekranında duran değişiklikler değil, başkasının taslağı yayına çıkardı.
      if (dirty && !(await save())) return;
      setPage(await api.post<BookingPage>('booking-page/publish'));
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setPublishing(false);
    }
  }

  if (access === 'misconfigured') {
    // Yazabiliyor ama okuyamıyor. Boş bir editör göstermek, üzerine yazacağı
    // şeyi görmeden kaydetmesine yol açardı.
    return <Alert tone="warn">{t('error.permissionMisconfigured')}</Alert>;
  }
  if (access === 'none') return <Alert tone="warn">{t('error.forbiddenPage')}</Alert>;

  const selectedBlock = selected === null ? undefined : sections[selected];

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col">
      <PublishBar
        page={page}
        draft={content?.draft ?? null}
        dirty={dirty}
        saving={saving}
        publishing={publishing}
        readOnly={readOnly}
        onSave={() => void save()}
        onPublish={() => void publish()}
      />

      <div className="flex min-h-0 flex-1">
        <section className="w-64 shrink-0 overflow-y-auto border-r border-line p-3">
          <div className="mb-2 flex gap-1" role="tablist" aria-label={t('editor.title')}>
            {(['content', 'theme', 'seo'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`rounded px-2 py-1 text-xs ${tab === value ? 'bg-brand-soft font-medium' : 'text-ink-soft'}`}
              >
                {t(value === 'content' ? 'editor.blocks' : value === 'theme' ? 'editor.theme' : 'editor.seo')}
              </button>
            ))}
          </div>

          {tab === 'content' ? (
            <>
              <BlockList
                sections={sections}
                selected={selected}
                readOnly={readOnly}
                onSelect={setSelected}
                onMove={(from, to) => mutate(() => setSections((current) => moveBlock(current, from, to)))}
                onRemove={(index) =>
                  mutate(() => {
                    setSections((current) => removeBlock(current, index));
                    setSelected(null);
                  })
                }
                onToggleVisible={(index) =>
                  mutate(() =>
                    setSections((current) => {
                      const block = current[index];
                      if (block === undefined) return current;
                      return replaceBlock(current, index, {
                        ...block,
                        visible: block.visible === false,
                      });
                    }),
                  )
                }
              />
              {readOnly ? null : (
                <div className="mt-3 flex flex-wrap gap-1">
                  {BLOCK_TYPES.map((type: BlockType) => (
                    <Button
                      key={type}
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        mutate(() => {
                          setSections((current) => [...current, emptyBlock(type)]);
                          setSelected(sections.length);
                        })
                      }
                    >
                      + {t(BLOCK_LABEL_KEY[type])}
                    </Button>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {tab === 'theme' ? (
            <ThemePanel
              theme={theme}
              readOnly={readOnly}
              onChange={(next) => mutate(() => setTheme(next))}
            />
          ) : null}

          {tab === 'seo' ? (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm">
                Başlık
                <input
                  value={seo.title ?? ''}
                  onChange={(event) => mutate(() => setSeo({ ...seo, title: event.target.value }))}
                  readOnly={readOnly}
                  className="h-10 rounded-md border border-line-strong bg-card px-2"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                Açıklama
                <textarea
                  value={seo.description ?? ''}
                  onChange={(event) =>
                    mutate(() => setSeo({ ...seo, description: event.target.value }))
                  }
                  readOnly={readOnly}
                  rows={3}
                  className="rounded-md border border-line-strong bg-card p-2"
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="w-80 shrink-0 overflow-y-auto border-r border-line p-3">
          {restored ? (
            <Alert tone="info" className="mb-3">
              {t('editor.draftRestored')}
            </Alert>
          ) : null}
          {error !== null ? (
            <Alert tone="danger" className="mb-3">
              {error}
            </Alert>
          ) : null}
          {selectedBlock === undefined || selected === null ? (
            <p className="text-sm text-ink-soft">Düzenlemek için bir blok seçin.</p>
          ) : (
            <BlockForm
              block={selectedBlock}
              index={selected}
              branches={branches}
              errors={errors}
              readOnly={readOnly}
              onChange={(next) => mutate(() => setSections((current) => replaceBlock(current, selected, next)))}
            />
          )}
        </section>

        <section className="min-w-0 flex-1 p-3">
          <PreviewFrame payload={preview} />
        </section>
      </div>

      {conflict ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('editor.conflictTitle')}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-line bg-card p-5">
            <h2 className="mb-2 text-base font-semibold">{t('editor.conflictTitle')}</h2>
            <p className="mb-4 text-sm text-ink-soft">{t('editor.conflictDescription')}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConflict(false);
                  void load();
                }}
              >
                {t('editor.conflictReload')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setConflict(false);
                  void save(true);
                }}
              >
                {t('editor.conflictOverwrite')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toMessage(caught: unknown): string {
  return caught instanceof ApiProblemError
    ? describeProblem(caught.problem, caught.retryAfterSeconds).message
    : networkError().message;
}
