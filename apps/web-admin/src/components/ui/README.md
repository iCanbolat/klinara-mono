# `ui/` — bu dosyalar BİZİM

Buradaki bileşenler `shadcn/ui`den geldi ama artık **bu panelin** dosyaları.
`npx shadcn@latest add <x> --overwrite` çalıştırırsanız aşağıdakiler geri gelir
ve elle temizlenmesi gerekir:

1. **Gölgeler.** `shadow-xs/sm/md/lg` — hepsi silinmeli. iOS tasarım sisteminde
   sıfır gölge var; derinlik yalnız `bg-card` + `1px` kenarlıkla ifade ediliyor.
2. **Odak halkaları.** `focus-visible:ring-*`, `aria-invalid:ring-*`,
   `ring-offset-*` — silinmeli. Odak göstergesi `globals.css`teki tek global
   `:focus-visible` kuralı; iki gösterge üst üste biniyor.
   (`aria-invalid:border-destructive` KALIYOR — hata kenarlığı doğru.)
3. **`outline-hidden` / `outline-none`.** Etkileşimli kontrollerden silinmeli,
   yoksa o global kural hiç görünmüyor. Yalnız kapsayıcı panellerde
   (`DialogContent`, `PopoverContent`, `SheetContent`, scroll viewport) kalıyor:
   onlar açılışta programatik odak alıyor ve tüm paneli çerçevelemek gürültü.
4. **`dark:` varyantları.** Panelde dark mode yok; ölü sınıf bırakılmıyor.
5. **`rounded-md`.** `rounded-lg`e çevriliyor — `--radius: 12px` iOS
   `controlRadius`ı ve kontroller o yarıçapta.
6. **Kontrol yükseklikleri.** `h-9` → `h-11` (44px dokunma hedefi tabanı).
7. **`import { cn } from "cn"`.** `@/lib/cn` olmalı; `components.json`daki
   `utils` alias'ını shadcn bazen paket adı sanıyor (sahte bir `cn` npm paketi
   bile kurabiliyor — `package.json`ı kontrol edin).
8. **`transition-all`.** `transition-colors`a daraltılmalı. `all`, odak
   konturunu da animasyonluyor: halka anında değil süzülerek beliriyor ve
   klavye kullanıcısına gecikme hissi veriyor.

Ayrıca elle yazılmış ve shadcn karşılığı OLMAYAN sözleşmeler:

- `button.tsx` — `loading` prop'u (çocuklar mounted kalır, üstüne spinner biner,
  `aria-busy`). `test/dom/button.test.tsx` bunu sınıyor.
- `field.tsx` — `useId` + `aria-describedby` + `role="alert"` kablosu;
  `FieldSelect` bilerek YEREL `<select>` kullanıyor.
- `alert.tsx` — 4 ton ve `role="alert"` / `role="status"` ayrımı.
- `card.tsx` — dolgu kartın kendisinde (40+ çağrı yeri içeriği doğrudan veriyor).
