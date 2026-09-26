"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { cn } from '@/lib/cn'
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/*
 * shadcn "Date Picker" deseni: `Popover` + `Calendar`, tetikleyici bir düğme.
 *
 * Değer sözleşmesi yerel `<input type="date">` ile AYNI: `YYYY-MM-DD` dizesi,
 * boş = seçim yok. Böylece çağrı yerleri (`DayKey`, form taslakları, DTO'lar)
 * hiç değişmeden geçiş yapabildi.
 *
 * Dize ↔ `Date` çevrimi YEREL takvim günüyle yapılıyor (`new Date(y, m, d)`),
 * `new Date("2026-09-29")` ile DEĞİL: o UTC gece yarısı olarak ayrıştırılır ve
 * UTC'nin batısındaki bir tarayıcıda bir önceki güne kayar.
 */

function parseDayKey(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return undefined
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? undefined : date
}

function toDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${String(date.getFullYear())}-${month}-${day}`
}

const DISPLAY = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
})

export interface DatePickerProps
  extends Omit<React.ComponentProps<"button">, "value" | "onChange" | "type"> {
  /** `YYYY-MM-DD`; boş dize = seçim yok. */
  value: string
  onChange: (value: string) => void
  /** Seçilebilecek en erken gün (`YYYY-MM-DD`). */
  min?: string | undefined
  /** Seçilebilecek en geç gün (`YYYY-MM-DD`). */
  max?: string | undefined
  placeholder?: string
  /** İsteğe bağlı alanlarda "Temizle" düğmesi. */
  clearable?: boolean
  /**
   * Ay/yıl açılır listeleri — doğum tarihi gibi yıllar geriye giden alanlarda
   * ok tuşuyla yüzlerce ay gezmek yerine.
   */
  captionLayout?: "label" | "dropdown"
  /**
   * Seçilemeyecek günler (`YYYY-MM-DD` → neden). Tatil ve kapalı günler
   * takvimde üstü çizili ve pasif görünür; neden ekran okuyucuya iletilir.
   */
  unavailable?: ReadonlyMap<string, string> | undefined
  /** Görünen ay değişince (`YYYY-MM-01`) — çağıran o ayın gün durumlarını çeker. */
  onMonthChange?: ((month: string) => void) | undefined
}

function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Tarih seçin",
  clearable = false,
  captionLayout = "label",
  unavailable,
  onMonthChange,
  disabled,
  className,
  ...props
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = parseDayKey(value)
  const minDate = min === undefined ? undefined : parseDayKey(min)
  const maxDate = max === undefined ? undefined : parseDayKey(max)

  const unavailableDates = React.useMemo(
    () =>
      [...(unavailable?.keys() ?? [])].flatMap((key) => {
        const date = parseDayKey(key)
        return date === undefined ? [] : [date]
      }),
    [unavailable]
  )

  const disabledDays = [
    ...(minDate === undefined ? [] : [{ before: minDate }]),
    ...(maxDate === undefined ? [] : [{ after: maxDate }]),
    ...unavailableDates,
  ]

  const initialMonth = selected ?? minDate ?? new Date()

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Açılışta görünen ayın durumları istensin — kullanıcı ok tuşuna
        // basmadan da kapalı günleri görmeli.
        if (next) onMonthChange?.(toDayKey(new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1)))
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="date-picker"
          data-empty={selected === undefined}
          disabled={disabled}
          className={cn(
            "flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-base transition-colors md:text-sm",
            "data-[empty=true]:text-muted-foreground",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "aria-invalid:border-destructive",
            className
          )}
          {...props}
        >
          <span className="truncate">
            {selected === undefined ? placeholder : DISPLAY.format(selected)}
          </span>
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={initialMonth}
          onMonthChange={(month) => onMonthChange?.(toDayKey(month))}
          modifiers={{ unavailable: unavailableDates }}
          modifiersClassNames={{ unavailable: "line-through decoration-muted-foreground/60" }}
          labels={{
            labelDayButton: (date, modifiers) => {
              const base = DISPLAY.format(date)
              const reason = unavailable?.get(toDayKey(date))
              if (reason !== undefined) return `${base}, ${reason}`
              return modifiers.selected ? `${base}, seçili` : base
            },
          }}
          captionLayout={captionLayout}
          {...(captionLayout === "dropdown"
            ? {
                startMonth: minDate ?? new Date(1920, 0),
                endMonth: maxDate ?? new Date(new Date().getFullYear() + 5, 11),
              }
            : {})}
          disabled={disabledDays}
          onSelect={(date) => {
            if (date === undefined) return
            onChange(toDayKey(date))
            setOpen(false)
          }}
        />
        {clearable && selected !== undefined ? (
          <div className="border-t border-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onChange("")
                setOpen(false)
              }}
            >
              Temizle
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
