package com.klinara.android.features.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.formatting.BranchClock
import java.time.Instant

/**
 * Haftanın yedi günü. **Kaydırılmaz** ve her zaman seçili günün haftasını gösterir.
 *
 * Kaydırmalı sonsuz bir şerit iOS'ta da yok ve olmamasının bir sebebi var: ileri/geri
 * okları zaten gün gün ilerliyor ve şerit Pazartesi/Pazar sınırını geçince kendiliğinden
 * kayıyor. İki ayrı gezinme deyimi (kaydır + ok) aynı işi yapınca kullanıcı hangisinin
 * ne yaptığını denemek zorunda kalır.
 */
@Composable
fun CalendarDateStrip(
    clock: BranchClock,
    selected: Instant,
    /**
     * `localDay` → randevu sayısı. **Anahtarın YOKLUĞU "sıfır" demek değil, "bilmiyoruz"
     * demektir**: gün ve ajanda modunda sunucu yalnız seçili günün yoğunluğunu döndürür,
     * komşu günler hakkında hiçbir şey söylemez.
     *
     * iOS bu ayrımı yapmıyor ve o günler için "randevu yok" duyuruyor — ekran okuyucu
     * kullanıcısına bilmediğimiz bir şeyi olgu olarak söylemek. Burada bilinmeyen gün
     * sessiz kalır (ne nokta, ne sayı).
     */
    dayCounts: Map<String, Int>,
    onSelect: (Instant) -> Unit,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
) {
    // `IntrinsicSize.Max` + hücrede `fillMaxHeight`: şeridin yüksekliği en uzun
    // hücreye göre büyür ve yedi hücre yine EŞİT kalır. Sabit bir yükseklik
    // `fontScale 2.0`'da gün rakamını ortadan kesiyordu (emülatörde yakalandı) —
    // ve kesilen bir tarih, okunamayan bir tarihtir.
    Row(
        modifier = modifier.fillMaxWidth().height(IntrinsicSize.Max),
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        clock.weekDays(selected).forEach { day ->
            DayCell(
                clock = clock,
                day = day,
                isSelected = clock.isSameDay(day, selected),
                isToday = clock.isToday(day, now),
                count = dayCounts[clock.localDateString(day)],
                onSelect = onSelect,
            )
        }
    }
}

@Composable
private fun RowScope.DayCell(
    clock: BranchClock,
    day: Instant,
    isSelected: Boolean,
    isToday: Boolean,
    count: Int?,
    onSelect: (Instant) -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember(day) { MutableInteractionSource() }
    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)

    // Bugün kenarlıkla, seçili gün dolguyla anlatılır. İkisi çakışırsa seçim kazanır:
    // aynı hücrede iki ayrı vurgu, hangisinin ne demek olduğunu okunamaz kılardı.
    val showTodayRing = isToday && !isSelected
    val borderColor = if (showTodayRing) colors.sageDeep else colors.border
    val borderWidth = if (showTodayRing) KlinaraMetrics.focusBorderWidth else KlinaraMetrics.borderWidth

    val label = accessibilityLabel(clock, day, count)

    Column(
        modifier =
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .heightIn(min = CELL_HEIGHT)
                .background(if (isSelected) colors.sageDeep else colors.surfaceRaised, shape)
                .border(borderWidth, borderColor, shape)
                .klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = { onSelect(day) },
                ).clearAndSetSemantics {
                    // Tek düğüm: harf, rakam ve nokta ayrı ayrı okunursa TalkBack
                    // kullanıcısı bir günü duymak için üç kez kaydırır.
                    contentDescription = label
                    this.selected = isSelected
                    role = Role.Button
                }.padding(vertical = KlinaraMetrics.xs),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = clock.weekdayInitial(day).uppercase(TrLocaleTag),
            style = KlinaraType.label,
            color = if (isSelected) colors.surfaceRaised else colors.charcoalMuted,
        )
        Text(
            text = clock.dayNumber(day),
            style = KlinaraType.bodyL,
            fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
            color = if (isSelected) colors.surfaceRaised else colors.charcoal,
        )
        Box(
            modifier =
                Modifier
                    .size(DOT_SIZE)
                    .background(dotColor(count, isSelected, colors), CircleShape),
        )
    }
}

/** Bilinmeyen gün SESSİZ kalır; sıfır ile bilinmeyen aynı şey değildir. */
private fun accessibilityLabel(
    clock: BranchClock,
    day: Instant,
    count: Int?,
): String =
    buildString {
        append(clock.formatDate(day))
        when {
            count == null -> Unit
            count > 0 -> append(", $count randevu")
            else -> append(", randevu yok")
        }
    }

/** Nokta bir SAYIYI temsil eder; bilmediğimiz bir gün için çizilmez. */
private fun dotColor(
    count: Int?,
    isSelected: Boolean,
    colors: com.klinara.android.designsystem.KlinaraColors,
): Color =
    when {
        count == null || count == 0 -> Color.Transparent
        isSelected -> colors.surfaceRaised
        else -> colors.sage
    }

/**
 * Türkçe büyütme: `i` → `İ`. `SearchText` ile aynı tuzak, aynı çözüm.
 *
 * Cihazın yereli KULLANILMAZ: İngilizce bir cihazda "ç" → "C" olur ve hafta günü
 * baş harfleri sessizce yanlış çıkar.
 */
internal val TrLocaleTag: java.util.Locale = java.util.Locale.forLanguageTag("tr-TR")

/** Taban yükseklik; yazı ölçeği büyüdükçe hücre BÜYÜR, kırpmaz. */
private val CELL_HEIGHT = 60.dp
private val DOT_SIZE = 4.dp
