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
import { toast } from 'sonner';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Field, FieldTextarea } from '@/components/ui/field';
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
      toast.success(t('editor.published'));
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

      {/*
        Üç panel yalnız GENİŞ ekranda yan yana: 64+80 rem-dışı sabit genişlik +
        önizleme, 1280px altında hiçbirine yer bırakmıyordu ve sayfa yatay
        kayıyordu. Dar ekranda paneller alt alta geçiyor, önizleme gizleniyor —
        önizlemeyi 300px genişlikte göstermek zaten yanıltıcı olurdu.
      */}
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <section className="w-full shrink-0 overflow-y-auto border-b border-border p-4 xl:w-64 xl:border-r xl:border-b-0">
          {/*
            Radix `Tabs` — elle yazılmış `role="tablist"` DEĞİL.

            Öncekinde `tabpanel` hiç yoktu ve ok tuşlarıyla sekmeler arasında
            gezilemiyordu: ekran okuyucu "sekme 1/3" diyip sonra hangi panelin
            ona ait olduğunu söyleyemiyordu. Roving tabindex ve `aria-controls`
            artık kütüphaneden geliyor.
          */}
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
            <TabsList className="mb-3 w-full">
              <TabsTrigger value="content">{t('editor.blocks')}</TabsTrigger>
              <TabsTrigger value="theme">{t('editor.theme')}</TabsTrigger>
              <TabsTrigger value="seo">{t('editor.seo')}</TabsTrigger>
            </TabsList>

          <TabsContent value="content">
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
          </TabsContent>

          <TabsContent value="theme">
            <ThemePanel
              theme={theme}
              readOnly={readOnly}
              onChange={(next) => mutate(() => setTheme(next))}
            />
          </TabsContent>

          <TabsContent value="seo">
            <div className="flex flex-col gap-4">
              <Field
                label={t('editor.seoTitle')}
                value={seo.title ?? ''}
                onChange={(event) => mutate(() => setSeo({ ...seo, title: event.target.value }))}
                readOnly={readOnly}
              />
              <FieldTextarea
                label={t('editor.seoDescription')}
                value={seo.description ?? ''}
                onChange={(event) =>
                  mutate(() => setSeo({ ...seo, description: event.target.value }))
                }
                readOnly={readOnly}
                rows={3}
              />
            </div>
          </TabsContent>
          </Tabs>
        </section>

        <section className="w-full shrink-0 overflow-y-auto border-b border-border p-4 xl:w-80 xl:border-r xl:border-b-0">
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
            <p className="text-sm text-muted-foreground">{t('editor.selectBlock')}</p>
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

        <section className="hidden min-w-0 flex-1 p-4 xl:block">
          <PreviewFrame payload={preview} />
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
