package com.klinara.android.designsystem.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType

/**
 * Tutar alanı — `Long` minor unit üretir, **kayan nokta hiç yok** (§5.4).
 *
 * A5.1'de paket satış fiyatı için doğdu. Kullanıcının yazdığı metin alanın kendi
 * durumunda tutulur ve yalnız ayrıştırılabildiğinde yukarı [Long] olarak çıkar;
 * her tuşta `Long → metin → Long` dönüşümü "12,5" yazarken imleci zıplatır ve "12,50"yi
 * yazılamaz kılardı.
 *
 * Ayrıştırılamayan metin `null` olarak bildirilir ve alanın altına biçim uyarısı
 * düşer — boş bırakmakla yanlış yazmak aynı şey değil.
 *
 * [parse] ve [format] DIŞARIDAN verilir (çağıranlar `Money::parse`, `Money::formatPlain`
 * geçer): `designsystem/` bugüne kadar `services/`'e hiç bağımlı olmadı ve §3'ün
 * `:core:designsystem` ayrımı tetiklendiğinde bu bileşen yüzünden bir döngü doğmamalı.
 */
@Composable
fun KlinaraMoneyField(
    label: String,
    valueMinor: Long?,
    onValueChange: (Long?) -> Unit,
    parse: (String) -> Long?,
    format: (Long) -> String,
    modifier: Modifier = Modifier,
    placeholder: String = "0,00",
    error: String? = null,
    enabled: Boolean = true,
) {
    var text by rememberSaveable { mutableStateOf(valueMinor?.let(format).orEmpty()) }

    // Değer dışarıdan değişirse (form sıfırlandı, kayıt yüklendi) metni hizala; ama
    // kullanıcının yazdığıyla aynı değeri temsil ediyorsa DOKUNMA — yoksa "12,5" → "12,50".
    LaunchedEffect(valueMinor) {
        if (parse(text) != valueMinor) text = valueMinor?.let(format).orEmpty()
    }

    val isMalformed = text.isNotBlank() && parse(text) == null

    KlinaraTextField(
        label = label,
        value = text,
        onValueChange = { raw ->
            text = raw
            onValueChange(parse(raw))
        },
        modifier = modifier,
        placeholder = placeholder,
        error = error ?: if (isMalformed) "Tutarı 1.250,00 biçiminde yazın." else null,
        enabled = enabled,
        keyboardType = KeyboardType.Decimal,
    )
}
