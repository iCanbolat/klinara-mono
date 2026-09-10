package com.klinara.android.designsystem.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Türkiye telefon alanı: sabit `+90` öneki, `5XX XXX XX XX` maskesi, E.164 çıktısı.
 *
 * Ülke kodu seçici YOK — bu ürün Türkiye'deki klinikler için ve iOS'ta da öyle.
 * Değiştiği gün iki istemcide birlikte değişir (§1 Kural 2).
 */
@Composable
fun PhoneNumberField(
    label: String,
    e164: String,
    onE164Change: (String) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    enabled: Boolean = true,
    imeAction: ImeAction = ImeAction.Next,
    onSubmit: (() -> Unit)? = null,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val hasError = !error.isNullOrEmpty()

    // Hane dizisi alanın KENDİ durumudur; E.164 ondan türetilip dışarı verilir.
    //
    // Bunu `extractDigits(e164)` ile türetmek alanı yazılamaz yapar: `toE164` on haneden
    // azı için bilerek "" döndürüyor (yarım numara sunucuya gitmesin diye), dolayısıyla
    // ilk dokuz tuş vuruşu geri okunduğunda kayboluyordu.
    var digits by rememberSaveable { mutableStateOf(PhoneNumber.extractDigits(e164)) }

    // Dışarıdan TAM bir numara gelirse (düzenleme, ön doldurma) benimse. Boş bir e164
    // "henüz yarım" demektir ve kullanıcının yazdığını ezmemeli.
    LaunchedEffect(e164) {
        val incoming = PhoneNumber.extractDigits(e164)
        if (e164.isNotEmpty() && incoming != digits) digits = incoming
    }

    val borderColor by animateColorAsState(
        targetValue =
            when {
                hasError -> colors.danger
                focused -> colors.borderFocus
                else -> colors.border
            },
        animationSpec = tween(KlinaraMetrics.FEEDBACK_MILLIS),
        label = "phoneBorder",
    )
    val borderWidth by animateDpAsState(
        targetValue = if (focused || hasError) KlinaraMetrics.focusBorderWidth else KlinaraMetrics.borderWidth,
        animationSpec = tween(KlinaraMetrics.FEEDBACK_MILLIS),
        label = "phoneBorderWidth",
    )
    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            KlinaraType.labelText(label),
            style = KlinaraType.label,
            color = colors.charcoalMuted,
            modifier = Modifier.padding(bottom = KlinaraMetrics.sm),
        )

        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = KlinaraMetrics.fieldHeight)
                    .clip(shape)
                    .background(if (enabled) colors.surfaceRaised else colors.disabled)
                    .border(borderWidth, borderColor, shape)
                    .padding(horizontal = KlinaraMetrics.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            Text("+90", style = KlinaraType.bodyL, color = colors.charcoalMuted)
            Box(
                Modifier
                    .width(KlinaraMetrics.borderWidth)
                    .height(DIVIDER_HEIGHT)
                    .background(colors.border),
            )

            BasicTextField(
                value = digits,
                onValueChange = { raw ->
                    val next = PhoneNumber.extractDigits(raw)
                    if (next != digits) {
                        digits = next
                        onE164Change(PhoneNumber.toE164(next))
                    }
                },
                enabled = enabled,
                singleLine = true,
                textStyle = KlinaraType.bodyL.copy(color = colors.charcoal),
                cursorBrush = SolidColor(colors.sage),
                interactionSource = interactionSource,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = imeAction),
                keyboardActions =
                    KeyboardActions(
                        onDone = { onSubmit?.invoke() },
                        onNext = { onSubmit?.invoke() },
                    ),
                visualTransformation = PhoneMaskTransformation,
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics { contentDescription = "Telefon numarası, on hane" },
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (digits.isEmpty()) {
                            Text("5XX XXX XX XX", style = KlinaraType.bodyL, color = colors.charcoalMuted)
                        }
                        inner()
                    }
                },
            )
        }

        FieldErrorText(error)
    }
}

/**
 * `5XX XXX XX XX` — 3-3-2-2 gruplama, iOS `PhoneNumberField.format` paritesi.
 *
 * Offset eşlemesi kritik: yanlışsa imleç maskede yanlış haneye oturur ve kullanıcı
 * numarayı ortadan bozar. Boşluklar orijinal 3/6/8 indekslerinin ÖNÜNE, dönüşmüş
 * 3/7/10 indekslerine girer.
 */
private object PhoneMaskTransformation : VisualTransformation {
    private val ORIGINAL_BREAKS = PhoneNumber.SPACE_BREAKS
    private val TRANSFORMED_SPACES = listOf(3, 7, 10)

    override fun filter(text: AnnotatedString): TransformedText {
        val digits = text.text.take(PhoneNumber.LENGTH)
        val masked = PhoneNumber.format(digits)

        val mapping =
            object : OffsetMapping {
                override fun originalToTransformed(offset: Int): Int =
                    (offset + ORIGINAL_BREAKS.count { it <= offset }).coerceIn(0, masked.length)

                override fun transformedToOriginal(offset: Int): Int =
                    (offset - TRANSFORMED_SPACES.count { it < offset }).coerceIn(0, digits.length)
            }
        return TransformedText(AnnotatedString(masked), mapping)
    }
}

/**
 * Telefon numarası dönüşümleri. iOS `PhoneNumberField`'ın statik yardımcılarının
 * birebir karşılığı; birim testleri aynı vakaları sürer.
 */
object PhoneNumber {
    const val LENGTH = 10

    /** Boşluğun ÖNCESİNE geldiği hane indeksleri: 5XX_XXX_XX_XX */
    internal val SPACE_BREAKS = listOf(3, 6, 8)

    /**
     * Yapıştırılan her biçimi tek bir on haneye indirger:
     * `+90 532…`, `0532…`, `532…` ve aradaki boşluk/tire ne olursa olsun.
     */
    fun extractDigits(input: String): String {
        var raw = input.filter { it.isDigit() }
        if (raw.startsWith("90") && raw.length > LENGTH) raw = raw.drop(2)
        if (raw.startsWith("0")) raw = raw.drop(1)
        return raw.take(LENGTH)
    }

    /** `5XX XXX XX XX` — 3-3-2-2 gruplama. */
    fun format(digits: String): String =
        buildString {
            digits.forEachIndexed { index, ch ->
                if (index in SPACE_BREAKS) append(' ')
                append(ch)
            }
        }

    /**
     * Numara tamamlanmadıysa **boş string** döner — yarım bir numara asla
     * sunucuya gitmez ve `canSubmit` kontrolü tek bir `isNotEmpty()` olur.
     */
    fun toE164(digits: String): String = if (digits.length == LENGTH) "+90$digits" else ""

    /** Özet satırlarında gösterim: `+90 532 123 45 67`. */
    fun pretty(e164: String): String =
        if (!e164.startsWith("+90")) e164 else "+90 " + format(extractDigits(e164.drop(3)))
}

private val DIVIDER_HEIGHT = 22.dp
