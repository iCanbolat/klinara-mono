package com.klinara.android.designsystem.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.zIndex
import com.klinara.android.designsystem.KlinaraMetrics

/**
 * Basılı tutup sürüklenerek sıralanan liste — kart düzenini bozmadan.
 *
 * **Neden `LazyColumn` ve üçüncü parti bir kütüphane değil?** Sıralanan kümeler burada
 * küçük (kategoriler, etiketler) ve zaten `KlinaraCard` içinde tembel olmayan bir
 * `Column`'da duruyorlar; sırf sürükleme için bir bağımlılık eklemek, taşınan ağırlığa
 * değmezdi.
 *
 * **Yukarı/aşağı okları bunun yerine kaldırıldı.** Her satırda chevron + iki ok yan yana
 * durunca satır bir liste öğesi değil bir kontrol paneli gibi okunuyordu. Sürükleme
 * dokunmatikte doğru davranış, ama tek yol olamaz: [onMove] ayrıca her satıra TalkBack
 * özel aksiyonları ("Yukarı taşı" / "Aşağı taşı") olarak da bağlanır — sürükleme motor
 * beceri gerektirir, erişilebilirlik yolu gerektirmemeli.
 *
 * [onMove] kaynağı hedef konuma taşır (`from`, `to` — ikisi de görünür sıradaki indeks).
 */
@Composable
fun <T> KlinaraReorderableColumn(
    items: List<T>,
    key: (T) -> Any,
    onMove: (from: Int, to: Int) -> Unit,
    modifier: Modifier = Modifier,
    isEnabled: Boolean = true,
    verticalArrangement: Arrangement.Vertical = Arrangement.spacedBy(KlinaraMetrics.sm),
    itemContent: @Composable ColumnScope.(index: Int, item: T) -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val heights = remember { mutableStateMapOf<Int, Int>() }
    var draggingIndex by remember { mutableIntStateOf(-1) }
    var dragOffset by remember { mutableStateOf(0f) }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = verticalArrangement) {
        items.forEachIndexed { index, item ->
            val isDragging = index == draggingIndex
            // Sürüklenen satır kalkarken komşular yer açar: bırakmadan önce sonucun ne
            // olacağı görünür.
            val shift = neighbourShift(index, draggingIndex, dragOffset, heights, items.size)
            val animatedShift by animateFloatAsState(
                targetValue = shift,
                animationSpec = tween(SHIFT_MILLIS),
                label = "reorderShift",
            )

            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .zIndex(if (isDragging) 1f else 0f)
                        .graphicsLayer { translationY = if (isDragging) dragOffset else animatedShift }
                        .alpha(if (isDragging) DRAGGED_ALPHA else 1f)
                        .onGloballyPositioned { heights[index] = it.size.height }
                        .reorderSemantics(isEnabled, index, items.lastIndex, onMove)
                        .reorderDrag(
                            isEnabled = isEnabled && items.size > 1,
                            index = index,
                            itemKey = key(item),
                            itemCount = items.size,
                            heights = heights,
                            offset = { dragOffset },
                            onStart = {
                                draggingIndex = index
                                dragOffset = 0f
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            },
                            onOffsetChange = { dragOffset += it },
                            onFinish = { to ->
                                draggingIndex = -1
                                dragOffset = 0f
                                if (to != null && to != index) onMove(index, to)
                            },
                        ),
                content = { itemContent(index, item) },
            )
        }
    }
}

/** Sürüklenmeyen bir satırın açtığı yer — sürüklenen satır onu geçtiyse ters yöne ötelenir. */
private fun neighbourShift(
    index: Int,
    draggingIndex: Int,
    offset: Float,
    heights: Map<Int, Int>,
    count: Int,
): Float {
    if (draggingIndex < 0 || draggingIndex == index) return 0f
    val target = targetIndex(draggingIndex, offset, heights, count)
    val rowHeight = (heights[index] ?: 0).toFloat()
    return when {
        draggingIndex < index && index <= target -> -rowHeight
        draggingIndex > index && index >= target -> rowHeight
        else -> 0f
    }
}

/**
 * TalkBack yolu — görsel oklar kalktı, erişilebilirlik yolu kalkmadı.
 *
 * Sürükleme motor beceri ister; sıralamanın tek yolu olamaz.
 */
private fun Modifier.reorderSemantics(
    isEnabled: Boolean,
    index: Int,
    lastIndex: Int,
    onMove: (Int, Int) -> Unit,
): Modifier {
    if (!isEnabled) return this
    return semantics {
        customActions =
            buildList {
                if (index > 0) {
                    add(CustomAccessibilityAction("Yukarı taşı") { onMove(index, index - 1); true })
                }
                if (index < lastIndex) {
                    add(CustomAccessibilityAction("Aşağı taşı") { onMove(index, index + 1); true })
                }
            }
    }
}

/** Uzun basıp sürükleme jesti. [onFinish] iptal edildiğinde `null` alır. */
@Suppress("LongParameterList")
private fun Modifier.reorderDrag(
    isEnabled: Boolean,
    index: Int,
    itemKey: Any,
    itemCount: Int,
    heights: Map<Int, Int>,
    offset: () -> Float,
    onStart: () -> Unit,
    onOffsetChange: (Float) -> Unit,
    onFinish: (Int?) -> Unit,
): Modifier {
    if (!isEnabled) return this
    return pointerInput(itemKey, itemCount) {
        detectDragGesturesAfterLongPress(
            onDragStart = { onStart() },
            onDrag = { change, amount ->
                change.consume()
                onOffsetChange(amount.y)
            },
            onDragEnd = { onFinish(targetIndex(index, offset(), heights, itemCount)) },
            onDragCancel = { onFinish(null) },
        )
    }
}

/**
 * Sürükleme mesafesinin karşılık geldiği hedef indeks.
 *
 * Satırlar eşit yükseklikte olmayabilir (kimi kategoride "Pasif" rozeti var), o yüzden
 * mesafe ortalama yüksekliğe değil, **geçilen satırların** gerçek yüksekliklerine bölünür.
 */
private fun targetIndex(
    from: Int,
    offset: Float,
    heights: Map<Int, Int>,
    count: Int,
): Int {
    if (offset == 0f) return from
    var remaining = kotlin.math.abs(offset)
    val step = if (offset > 0) 1 else -1
    var index = from
    while (true) {
        val next = index + step
        if (next < 0 || next >= count) return index
        val threshold = (heights[next] ?: return index).toFloat() / 2f
        if (remaining < threshold) return index
        remaining -= (heights[next] ?: 0).toFloat().coerceAtLeast(1f)
        index = next
    }
}

private const val SHIFT_MILLIS = 160
private const val DRAGGED_ALPHA = 0.92f
