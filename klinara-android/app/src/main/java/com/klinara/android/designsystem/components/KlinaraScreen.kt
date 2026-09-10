package com.klinara.android.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Oturum açıldıktan sonraki her ekranın iskeleti — iOS `NavigationStack` +
 * `navigationTitle(_:)` + `.toolbar` paritesi (A0.3'ten A2.1'e ertelenmişti).
 *
 * `AuthScaffold`'un kardeşi ama aynısı değil: giriş ekranları büyük bir başlık bloğu
 * ve altta sabit bir aksiyon alanı taşır (tek soru, tek cevap); kabuk ekranları ise
 * ince bir üst çubuk ve kaydırılan içerik taşır. İkisini tek bileşende birleştirmek,
 * her çağıran için yarısı ölü bir parametre kümesi üretirdi.
 *
 * **Zemin burada boyanmaz.** `KlinaraTheme` kendi `Surface`'inde tam kanamalı
 * boyuyor; burada tekrar boyamak A0.2'de düzeltilen "sistem çubuklarının arkası
 * beyaz kalıyor" hatasını geri getirirdi. Ekran yalnız üst inset'i uygular; alt
 * inset alt gezinme çubuğunun işidir.
 */
@Composable
fun KlinaraScreen(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    scrollable: Boolean = true,
    contentPadding: PaddingValues = defaultContentPadding(),
    verticalSpacing: Dp = KlinaraMetrics.lg,
    trailing: @Composable (RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier = modifier.fillMaxSize().statusBarsPadding()) {
        TopBar(title = title, onBack = onBack, trailing = trailing)

        val bodyModifier =
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .let { if (scrollable) it.verticalScroll(rememberScrollState()) else it }
                .padding(contentPadding)

        Column(
            modifier = bodyModifier,
            verticalArrangement = Arrangement.spacedBy(verticalSpacing),
            content = content,
        )
    }
}

/**
 * Üst çubuk.
 *
 * Material3 `TopAppBar` KULLANILMADI: kendi tipografimizi, kendi yüksekliğimizi ve
 * ripple'sız geri düğmesini enjekte etmek için onun renk/scroll davranışının çoğunu
 * ezmek gerekiyordu — geriye taşıyıcı olarak hiçbir şey kalmıyordu. Bir `Row` dürüst.
 */
@Composable
private fun TopBar(
    title: String,
    onBack: (() -> Unit)?,
    trailing: @Composable (RowScope.() -> Unit)?,
) {
    val colors = KlinaraTheme.colors
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(TOP_BAR_HEIGHT)
                .padding(horizontal = KlinaraMetrics.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        if (onBack != null) {
            val interaction = remember { MutableInteractionSource() }
            Box(
                modifier =
                    Modifier
                        .size(KlinaraMetrics.minTouchTarget)
                        .klinaraClickable(true, Role.Button, interaction, onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Geri",
                    tint = colors.charcoal,
                    modifier = Modifier.size(BACK_ICON_SIZE),
                )
            }
        }

        Text(
            title,
            style = KlinaraType.titleM,
            color = colors.charcoal,
            modifier =
                Modifier
                    .weight(1f)
                    .padding(start = if (onBack == null) KlinaraMetrics.md else 0.dp)
                    // Ekran okuyucu başlığı bir başlık olarak duyursun; aksi hâlde
                    // TalkBack kullanıcısı hangi ekranda olduğunu ancak metni
                    // okuyarak anlar.
                    .semantics { heading() },
        )

        trailing?.invoke(this)
    }
}

/**
 * Gövdenin varsayılan dolgusu — kart ve form ekranlarının ölçüsü.
 *
 * Parametreleştirilmesinin sebebi takvim ızgarası (A3): yedi sütunlu bir hafta,
 * iki yanda 24 dp ile okunamayacak kadar daralıyor. Varsayılanı değiştirmek yerine
 * ÇAĞIRANIN daraltabilmesi gerekiyordu; her ekranın kendi dolgusunu kurması ise
 * `screenInset`'i tek kaynak olmaktan çıkarırdı.
 */
@Composable
fun defaultContentPadding(): PaddingValues =
    PaddingValues(
        start = KlinaraMetrics.screenInset,
        end = KlinaraMetrics.screenInset,
        top = KlinaraMetrics.md,
        bottom = KlinaraMetrics.xl,
    )

private val TOP_BAR_HEIGHT = 56.dp
private val BACK_ICON_SIZE = 24.dp
