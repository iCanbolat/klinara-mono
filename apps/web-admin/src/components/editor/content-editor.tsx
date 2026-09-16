'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CONTENT_LIMITS,
  ERROR_CODES,
  resolveAssets,
  type BlockType,
  type BookingPage,
  type BookingPageContent,
  type Branch,
  type ContentBlockInput,
  type PublicImage,
  type PublicCategory,
  type PublicSitePayload,
  type SeoInput,
  type Service,
  type ServiceCategorySummary,
  type ThemeInput,
} from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { bookingPageAccess } from '@/lib/permissions';
import { insertBlock, moveBlock, removeBlock, replaceBlock } from '@/lib/editor/move-block';
import { emptyBlock } from '@/lib/editor/block-schema';
import { validateSections, validateSeo } from '@/lib/editor/validate';
import { clearDraft, readDraft, saveDraft, shouldRestore } from '@/lib/editor/draft-recovery';
import { useAssetLibrary } from '@/lib/editor/use-asset-library';
import { buildPreviewCatalog } from '@/lib/editor/preview-catalog';
import { useSession } from '@/components/session/session-provider';
import { toast } from 'sonner';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Field, FieldTextarea } from '@/components/ui/field';
import { publicEnv } from '@/config/env';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AddBlockMenu } from './add-block-menu';
import { AssetPicker } from './asset-picker';
import { BlockList } from './block-list';
import { EditorEmptyState, BlockFormHeader } from './editor-panels';
import { SeoPreview } from './seo-preview';
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
  const [catalog, setCatalog] = useState<{
    services: Service[];
    categories: ServiceCategorySummary[];
  } | null>(null);
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
        api.get<{ data: Branch[] }>('branches'),
      ]);
      setPage(loadedPage);
      setContent(loadedContent);
      setBranches(loadedBranches.data);
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

  // Hizmet listesi bloğu önizlemede boş kalmasın. Katalog editörde
  // düzenlenmiyor; bir kez okumak yeterli.
  useEffect(() => {
    void (async () => {
      try {
        const [services, categories] = await Promise.all([
          api.get<{ data: Service[] }>('services'),
          api.get<{ data: ServiceCategorySummary[] }>('service-categories'),
        ]);
        setCatalog({ services: services.data, categories: categories.data });
      } catch {
        // Katalog okunamazsa blok "hizmet yok" gösterir; editör çalışmaya devam eder.
      }
    })();
  }, []);

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
    const categories: PublicCategory[] =
      catalog === null
        ? []
        : buildPreviewCatalog(catalog.services, catalog.categories, {
            showPrices: previewBase.settings.showPrices,
            currency: previewBase.currency,
          });
    return {
      site: {
        ...previewBase,
        theme: resolveAssets(theme, assetIndex),
        sections: resolveAssets(sections, assetIndex),
        seo: resolveAssets(seo, assetIndex),
      },
      categories,
    };
  }, [previewBase, catalog, theme, sections, seo, assetIndex]);

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
      toast.success(t('editor.published'));
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setPublishing(false);
    }
  }

  /**
   * ⌘S / Ctrl+S — tarayıcının "sayfayı kaydet" diyaloğu yerine taslağı kaydeder.
   * Ref üzerinden: dinleyici bir kez bağlanıyor ama her zaman güncel `save`i
   * ve durumu görüyor.
   */
  const shortcut = useRef<() => void>(() => undefined);
  useEffect(() => {
    shortcut.current = () => {
      if (!readOnly && dirty && !saving) void save();
    };
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        shortcut.current();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function addBlock(type: BlockType): void {
    mutate(() => {
      const next = insertBlock(sections, emptyBlock(type), selected);
      setSections(next.items);
      setSelected(next.index);
      setTab('content');
    });
  }

  if (access === 'misconfigured') {
    // Yazabiliyor ama okuyamıyor. Boş bir editör göstermek, üzerine yazacağı
    // şeyi görmeden kaydetmesine yol açardı.
    return <Alert tone="warn">{t('error.permissionMisconfigured')}</Alert>;
  }
  if (access === 'none') return <Alert tone="warn">{t('error.forbiddenPage')}</Alert>;

  const selectedBlock = selected === null ? undefined : sections[selected];

  // Yayındaki sayfa. Yerelde kanonik adres (`*.klinara.localhost`) çözülmüyor;
  // önizleme origin'i geliştirme slug'ıyla aynı sayfayı açıyor.
  const liveUrl =
    page === null || page.status !== 'published'
      ? null
      : publicEnv.bookingPreviewOrigin.startsWith('http://localhost') || page.canonicalUrl === ''
        ? publicEnv.bookingPreviewOrigin || null
        : page.canonicalUrl;

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

      {/*
        Üç panel yalnız GENİŞ ekranda yan yana: iki sabit panel + önizleme,
        1280px altında hiçbirine yer bırakmıyordu ve sayfa yatay kayıyordu. Dar
        ekranda paneller alt alta geçiyor, önizleme gizleniyor — önizlemeyi
        300px genişlikte göstermek zaten yanıltıcı olurdu.
      */}
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <section className="flex w-full shrink-0 flex-col border-b border-border bg-card/40 xl:w-72 xl:border-r xl:border-b-0">
          {/*
            Radix `Tabs` — elle yazılmış `role="tablist"` DEĞİL.

            Öncekinde `tabpanel` hiç yoktu ve ok tuşlarıyla sekmeler arasında
            gezilemiyordu: ekran okuyucu "sekme 1/3" diyip sonra hangi panelin
            ona ait olduğunu söyleyemiyordu. Roving tabindex ve `aria-controls`
            artık kütüphaneden geliyor.
          */}
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="flex min-h-0 flex-1 flex-col">
            <div className="px-4 pt-4">
              <TabsList className="w-full">
                <TabsTrigger value="content">{t('editor.blocks')}</TabsTrigger>
                <TabsTrigger value="theme">{t('editor.theme')}</TabsTrigger>
                <TabsTrigger value="seo">{t('editor.seo')}</TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <TabsContent value="content" className="mt-0 flex flex-col gap-3">
                <BlockList
                  sections={sections}
                  selected={selected}
                  readOnly={readOnly}
                  onSelect={setSelected}
                  onMove={(from, to) =>
                    mutate(() => {
                      setSections((current) => moveBlock(current, from, to));
                      if (selected === from) setSelected(to);
                    })
                  }
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
                  <AddBlockMenu hasSelection={selected !== null} onAdd={addBlock} />
                )}
              </TabsContent>

              <TabsContent value="theme" className="mt-0">
                <ThemePanel
                  theme={theme}
                  readOnly={readOnly}
                  onChange={(next) => mutate(() => setTheme(next))}
                />
              </TabsContent>

              <TabsContent value="seo" className="mt-0">
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-muted-foreground">{t('editor.seoHint')}</p>
                  <Field
                    label={t('editor.seoTitle')}
                    value={seo.title ?? ''}
                    maxLength={CONTENT_LIMITS.seo.title}
                    hint={t('editor.charCount', {
                      count: (seo.title ?? '').length,
                      max: CONTENT_LIMITS.seo.title,
                    })}
                    onChange={(event) => mutate(() => setSeo({ ...seo, title: event.target.value }))}
                    readOnly={readOnly}
                  />
                  <FieldTextarea
                    label={t('editor.seoDescription')}
                    value={seo.description ?? ''}
                    maxLength={CONTENT_LIMITS.seo.description}
                    hint={t('editor.charCount', {
                      count: (seo.description ?? '').length,
                      max: CONTENT_LIMITS.seo.description,
                    })}
                    onChange={(event) =>
                      mutate(() => setSeo({ ...seo, description: event.target.value }))
                    }
                    readOnly={readOnly}
                    rows={4}
                  />
                  <AssetPicker
                    label={t('editor.seoImage')}
                    assetId={seo.ogImageAssetId ?? null}
                    purpose="og_image"
                    readOnly={readOnly}
                    onChange={(ogImageAssetId) => mutate(() => setSeo(withOgImage(seo, ogImageAssetId)))}
                  />
                  <SeoPreview
                    url={page?.canonicalUrl || liveUrl || ''}
                    title={seo.title ?? ''}
                    description={seo.description ?? ''}
                  />
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </section>

        <section className="w-full shrink-0 overflow-y-auto border-b border-border p-5 xl:w-96 xl:border-r xl:border-b-0">
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
            <EditorEmptyState />
          ) : (
            <div className="flex flex-col gap-5">
              <BlockFormHeader block={selectedBlock} />
              <BlockForm
                block={selectedBlock}
                index={selected}
                branches={branches}
                errors={errors}
                readOnly={readOnly}
                onChange={(next) => mutate(() => setSections((current) => replaceBlock(current, selected, next)))}
              />
            </div>
          )}
        </section>

        <section className="hidden min-w-0 flex-1 bg-muted/40 p-4 xl:block">
          <PreviewFrame payload={preview} liveUrl={liveUrl} />
        </section>
      </div>

      {/*
        Çakışma diyaloğu Radix `AlertDialog` ile.

        Kapatma yolu YOK (`X` ve dışarı tıklama kapatmıyor): kullanıcı iki
        seçenekten birini seçmeli. Modalı kapatıp taslakla oynamaya devam etmek,
        kaydedilemeyeceğini bilmediği bir düzenleme yapmasına yol açardı.
      */}
      <AlertDialog open={conflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('editor.conflictTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('editor.conflictDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setConflict(false);
                void load();
              }}
            >
              {t('editor.conflictReload')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setConflict(false);
                void save(true);
              }}
            >
              {t('editor.conflictOverwrite')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function toMessage(caught: unknown): string {
  return caught instanceof ApiProblemError
    ? describeProblem(caught.problem, caught.retryAfterSeconds).message
    : networkError().message;
}

/** SEO görselini ayarla ya da anahtarı tamamen çıkar (`exactOptionalPropertyTypes`). */
function withOgImage(seo: SeoInput, ogImageAssetId: string | null): SeoInput {
  if (ogImageAssetId !== null) return { ...seo, ogImageAssetId };
  const next: SeoInput = {};
  if (seo.title !== undefined) next.title = seo.title;
  if (seo.description !== undefined) next.description = seo.description;
  return next;
}
