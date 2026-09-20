package com.klinara.android.designsystem.components

import android.provider.Settings
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme

/**
 * Yükleme yer tutucusu — "skeleton". iOS `KlinaraSkeleton` paritesi.
 *
 * Ekranların yarısında yükleme hâli tek bir `Text("Yükleniyor…")` idi: ne kaç
 * satır geleceğini, ne gövdenin liste mi form mu olduğunu söylüyordu ve veri
 * gelince tek satırlık bir ekran birden dolup içerik zıplıyordu. Yer tutucu
 * gelecek düzenin ölçüsünü şimdiden çiziyor; yükleme bitince kutular yerini
 * metne bırakıyor, düzen kaymıyor.
 *
 * **Hareket nabız, parıltı değil.** Marka kişiliği "calm, authoritative"
 * (`KlinaraMetrics` hareket notu): soldan sağa süzülen bir parıltı ekranın en
 * dikkat çekici öğesi olurdu ve karanlık temada vurgunun tonunu palette
 * olmayan bir renge kaçırırdı. Tüm iskelet grubu tek parça hâlinde yavaşça
 * soluyor. Sistemde animasyonlar kapalıyken (erişilebilirlik ya da pil
 * tasarrufu) hiç kıpırdamaz — bilgiyi taşıyan şey zaten *düzen*.
 *
 * **Ekran boşluğu uygulamaz.** `KlinaraScreen` içeriğine `contentPadding`
 * zaten veriliyor; burada tekrar uygulamak her çağıranda çift dolgu demekti.
 */

// --- Hareket ---

/**
 * İskelet grubunun nabzı. TEK bir üst düğüme uygulanır: her çubuğa ayrı
 * animasyon vermek, aynı anda başlamayan onlarca zamanlayıcı demekti.
 */
@Composable
private fun skeletonAlpha(): Float {
    val context = LocalContext.current
    // Sistem animasyonları kapalıyken (Geliştirici seçenekleri, "Animasyonları
    // kaldır" erişilebilirlik ayarı, pil tasarrufu) nabız da durur.
    val animated =
        remember(context) {
            Settings.Global.getFloat(
                context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f,
            ) != 0f
        }
    val transition = rememberInfiniteTransition(label = "skeleton")
    val pulse by
        transition.animateFloat(
            initialValue = 1f,
            targetValue = 0.45f,
            animationSpec =
                infiniteRepeatable(
                    animation = tween(durationMillis = 900, easing = FastOutSlowInEasing),
                    repeatMode = RepeatMode.Reverse,
                ),
            label = "skeleton-alpha",
        )
    return if (animated) pulse else 1f
}

/**
 * Nabız + tek erişilebilirlik düğümü.
 *
 * `clearAndSetSemantics`: TalkBack kullanıcısına otuz adet anlamsız gri kutuyu
 * tek tek okutmak, "Yükleniyor…" metninden de kötü olurdu.
 */
private fun Modifier.skeletonGroup(alpha: Float): Modifier =
    this.alpha(alpha).clearAndSetSemantics { contentDescription = "Yükleniyor" }

// --- İlkeler ---

/**
 * Bir metin satırının yerini tutan kutu.
 *
 * [width] null → satır kalan genişliği doldurur. Gerçek metin nadiren tam
 * genişlikte biter; ölçüler çağıranda kasıtlı olarak farklı verilir ki liste
 * bir tablo gibi değil, bir metin bloğu gibi okunsun.
 */
@Composable
fun KlinaraSkeletonBar(
    modifier: Modifier = Modifier,
    width: Dp? = null,
    height: Dp = 12.dp,
    cornerRadius: Dp = 6.dp,
) {
    Box(
        modifier
            .let { if (width == null) it.fillMaxWidth() else it.width(width) }
            .height(height)
            .clip(RoundedCornerShape(cornerRadius))
            .background(KlinaraTheme.colors.border.copy(alpha = 0.55f)),
    )
}

/** Avatar, ikon ya da renk noktasının yerini tutan daire. */
@Composable
fun KlinaraSkeletonCircle(
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(KlinaraTheme.colors.border.copy(alpha = 0.55f)),
    )
}

/**
 * [KlinaraCard]'ın yer tutucusu — aynı zemin, aynı kenarlık, aynı yarıçap.
 *
 * Kartın *kabuğu* yükleme sırasında da gerçek: kaybolan yalnız içindeki metin.
 * Kabuğu da gri bir kutuya indirgemek, veri gelince kartın kenarlığını birden
 * belirtirdi.
 */
@Composable
private fun SkeletonCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.cardRadius)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(colors.surfaceRaised)
                .border(KlinaraMetrics.borderWidth, colors.border, shape)
                .padding(KlinaraMetrics.md),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        content = content,
    )
}

private val TITLE_WIDTHS = listOf(168.dp, 132.dp, 196.dp, 148.dp, 180.dp, 120.dp)
private val DETAIL_WIDTHS = listOf(104.dp, 136.dp, 88.dp, 120.dp, 96.dp, 128.dp)

/** [KlinaraRow] yer tutucusu: başlık + isteğe bağlı alt satır, sağda değer. */
@Composable
fun KlinaraSkeletonRow(
    modifier: Modifier = Modifier,
    hasDetail: Boolean = true,
    hasValue: Boolean = false,
    /** Satırlar aynı boyda olmasın diye çubuk genişliklerini kaydırır. */
    seed: Int = 0,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = KlinaraMetrics.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            KlinaraSkeletonBar(width = TITLE_WIDTHS[seed.mod(TITLE_WIDTHS.size)], height = 13.dp)
            if (hasDetail) {
                KlinaraSkeletonBar(width = DETAIL_WIDTHS[seed.mod(DETAIL_WIDTHS.size)], height = 11.dp)
            }
        }
        if (hasValue) {
            KlinaraSkeletonBar(width = 56.dp, height = 13.dp)
        }
    }
}

// --- Biçim ---

/**
 * Hangi düzenin yer tutulacağı. iOS `KlinaraSkeletonStyle` ile birebir aynı
 * kümeler; iki istemcide farklı iskelet çizmek, aynı ekranın iki platformda
 * farklı bir şey vaat etmesi olurdu.
 */
@Immutable
data class KlinaraSkeletonStyle(
    val kind: Kind,
    val count: Int = 5,
    /** Gövdenin üstünde yatay bir filtre hapı şeridi var mı? */
    val hasPills: Boolean = false,
) {
    /** Gövdenin üstüne yatay bir filtre hapı şeridi ekler. */
    fun withPills() = copy(hasPills = true)

    enum class Kind {
        /** Tek kart, içinde ayraçlı satırlar — ayar ve özet listeleri. */
        Rows,

        /** Ayrı ayrı kartlar — müşteri, paket, personel listeleri. */
        Cards,

        /** İki sütunlu özet kartı ızgarası. */
        Stats,

        /** Özet ızgarası + altında bir grafik kartı — rapor ekranları. */
        Report,

        /** Yalnız grafik kartı. */
        Chart,

        /** Başlık bloğu + iki bölüm — detay ekranları. */
        Detail,

        /** Etiketli alan yığını — form ve editör ekranları. */
        Form,

        /** Saat sütunlu randevu listesi — takvim ve ajanda. */
        Agenda,
    }

    companion object {
        /**
         * Adet SABİT bir kümeden seçilir, çağıranda serbestçe yazılmaz.
         *
         * "Kaç satır?" sorusunun ekran başına ayrı bir cevabı olsaydı, aynı
         * listenin iki yerdeki yer tutucusu farklı boyda çıkardı; üstelik
         * çağıranda duran çıplak sayı neyi ölçtüğünü söylemiyordu.
         */

        /** Kart içinde üç satır — bölüm boyutunda bir liste. */
        val rowsShort = KlinaraSkeletonStyle(Kind.Rows, 3)

        /** Kart içinde beş satır — ekranı dolduran ayar/özet listeleri. */
        val rows = KlinaraSkeletonStyle(Kind.Rows, 5)

        /** Kart içinde yedi satır — haftanın günleri gibi sabit uzunluktakiler. */
        val rowsLong = KlinaraSkeletonStyle(Kind.Rows, 7)

        /** Üç ayrı kart. */
        val cardsShort = KlinaraSkeletonStyle(Kind.Cards, 3)

        /** Dört ayrı kart. */
        val cards = KlinaraSkeletonStyle(Kind.Cards, 4)

        /** Altı ayrı kart — uzun kayıt listeleri. */
        val cardsLong = KlinaraSkeletonStyle(Kind.Cards, 6)

        /** İki sütunlu özet kartları. */
        val stats = KlinaraSkeletonStyle(Kind.Stats, 4)

        /** Özet + grafik. */
        val report = KlinaraSkeletonStyle(Kind.Report, 4)

        /** Tek başına grafik kartı — özet şeridi zaten çizilmişken. */
        val chart = KlinaraSkeletonStyle(Kind.Chart, 0)

        /** Detay ekranı: başlık bloğu + iki kart. */
        val detail = KlinaraSkeletonStyle(Kind.Detail, 3)

        /** Üç alanlı form. */
        val formShort = KlinaraSkeletonStyle(Kind.Form, 3)

        /** Dört alanlı form. */
        val form = KlinaraSkeletonStyle(Kind.Form, 4)

        /** Beş alanlı form — düzenleyici ekranlar. */
        val formLong = KlinaraSkeletonStyle(Kind.Form, 5)

        /** Ajanda / takvim listesi. */
        val agenda = KlinaraSkeletonStyle(Kind.Agenda, 5)
    }
}

// --- Çizim ---

/**
 * Bir [KlinaraSkeletonStyle]i çizer.
 *
 * Ekran boşluklarıyla aynı ızgarayı kullanır (`KlinaraScreen` dolgusunun
 * içinde, bölümler arası `lg`): yer tutucu ile gerçek içerik farklı bir
 * ızgarada otursaydı, veri gelince her şey bir kez kayardı — yer tutucunun
 * var olma sebebi tam olarak bu kaymayı önlemek.
 */
@Composable
fun KlinaraSkeleton(
    style: KlinaraSkeletonStyle,
    modifier: Modifier = Modifier,
) {
    val alpha = skeletonAlpha()
    Column(
        modifier = modifier.fillMaxWidth().skeletonGroup(alpha),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.lg),
    ) {
        if (style.hasPills) PillRow()

        when (style.kind) {
            KlinaraSkeletonStyle.Kind.Rows ->
                SkeletonCard {
                    repeat(style.count.coerceAtLeast(1)) { index ->
                        if (index > 0) KlinaraDivider()
                        KlinaraSkeletonRow(hasValue = true, seed = index)
                    }
                }

            KlinaraSkeletonStyle.Kind.Cards ->
                repeat(style.count.coerceAtLeast(1)) { index ->
                    SkeletonCard { KlinaraSkeletonRow(seed = index) }
                }

            KlinaraSkeletonStyle.Kind.Stats -> StatGrid(style.count)

            KlinaraSkeletonStyle.Kind.Report -> {
                StatGrid(style.count)
                ChartCard()
            }

            KlinaraSkeletonStyle.Kind.Chart -> ChartCard()

            KlinaraSkeletonStyle.Kind.Detail -> {
                Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                    KlinaraSkeletonBar(width = 208.dp, height = 20.dp)
                    KlinaraSkeletonBar(width = 132.dp, height = 13.dp)
                }
                SkeletonCard {
                    repeat(3) { index ->
                        if (index > 0) KlinaraDivider()
                        KlinaraSkeletonRow(hasDetail = false, hasValue = true, seed = index)
                    }
                }
                SkeletonCard {
                    repeat(2) { index ->
                        if (index > 0) KlinaraDivider()
                        KlinaraSkeletonRow(seed = index + 3)
                    }
                }
            }

            KlinaraSkeletonStyle.Kind.Form ->
                repeat(style.count.coerceAtLeast(1)) { index ->
                    FormField(index)
                }

            KlinaraSkeletonStyle.Kind.Agenda ->
                repeat(style.count.coerceAtLeast(1)) { index ->
                    Row(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.md)) {
                        // Saat sütunu: ajandanın sol kenarı sabit genişlikte ve
                        // veri gelince kaymamalı.
                        KlinaraSkeletonBar(
                            width = 44.dp,
                            height = 13.dp,
                            modifier = Modifier.padding(top = KlinaraMetrics.md),
                        )
                        SkeletonCard { KlinaraSkeletonRow(hasValue = true, seed = index) }
                    }
                }
        }
    }
}

/**
 * Bölüm içi (kart içindeki) yer tutucu.
 *
 * [KlinaraSkeleton] bir ekranın gövdesini üstleniyor; müşteri kartındaki
 * "Notlar", "Paketler", "Zaman çizelgesi" gibi bölümler ise ZATEN bir kartın
 * içinde ve kendi başlığını çizmiş oluyor. O bölümlerin ihtiyacı yalnız
 * birkaç satır.
 */
@Composable
fun KlinaraSkeletonSection(
    modifier: Modifier = Modifier,
    rows: Int = DEFAULT_SECTION_ROWS,
    hasDetail: Boolean = true,
) {
    val alpha = skeletonAlpha()
    Column(modifier = modifier.fillMaxWidth().skeletonGroup(alpha)) {
        repeat(rows.coerceAtLeast(1)) { index ->
            if (index > 0) KlinaraDivider()
            KlinaraSkeletonRow(hasDetail = hasDetail, seed = index)
        }
    }
}

/**
 * Çip ızgarası yer tutucusu — randevu akışındaki saat seçimi.
 *
 * Kaç saatin geleceği bilinmiyor ama *ızgara olduğu* biliniyor: tek satırlık
 * bir "Yükleniyor…" bunu söylemiyor ve saatler gelince alan bir anda üç satır
 * büyüyordu.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KlinaraSkeletonChips(
    modifier: Modifier = Modifier,
    count: Int = DEFAULT_CHIP_COUNT,
) {
    val alpha = skeletonAlpha()
    FlowRow(
        modifier = modifier.fillMaxWidth().skeletonGroup(alpha),
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        repeat(count.coerceAtLeast(1)) {
            KlinaraSkeletonBar(width = 74.dp, height = 40.dp, cornerRadius = KlinaraMetrics.controlRadius)
        }
    }
}

// --- Parçalar ---

/** Yatay filtre hapı şeridi — müşterilerde etiket, takvimde personel. */
@Composable
private fun PillRow() {
    val widths = listOf(56.dp, 88.dp, 72.dp, 96.dp)
    Row(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        widths.forEach { width ->
            KlinaraSkeletonBar(width = width, height = 34.dp, cornerRadius = 17.dp)
        }
    }
}

private val STAT_LABEL_WIDTHS = listOf(96.dp, 76.dp, 108.dp, 88.dp)
private val STAT_VALUE_WIDTHS = listOf(72.dp, 96.dp, 60.dp, 84.dp)
private val STAT_HINT_WIDTHS = listOf(120.dp, 88.dp, 104.dp, 132.dp)

/** [KlinaraStatStrip] ile aynı ızgara: iki sütun, eşit boy. */
@Composable
private fun StatGrid(count: Int) {
    val total = count.coerceAtLeast(2)
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        for (start in 0 until total step 2) {
            Row(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                StatCard(start, Modifier.weight(1f))
                if (start + 1 < total) {
                    StatCard(start + 1, Modifier.weight(1f))
                } else {
                    Box(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun StatCard(
    seed: Int,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.cardRadius)
    Column(
        modifier =
            modifier
                .clip(shape)
                .background(colors.surfaceRaised)
                .border(KlinaraMetrics.borderWidth, colors.border, shape)
                .padding(KlinaraMetrics.md),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        KlinaraSkeletonBar(width = STAT_LABEL_WIDTHS[seed.mod(4)], height = 10.dp)
        KlinaraSkeletonBar(width = STAT_VALUE_WIDTHS[seed.mod(4)], height = 20.dp)
        KlinaraSkeletonBar(width = STAT_HINT_WIDTHS[seed.mod(4)], height = 10.dp)
    }
}

private val CHART_BAR_HEIGHTS = listOf(56.dp, 92.dp, 40.dp, 120.dp, 72.dp, 104.dp, 48.dp)

/** Grafik kartı: eksen çizgisi üzerinde değişen boyda sütunlar. */
@Composable
private fun ChartCard() {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.cardRadius)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(colors.surfaceRaised)
                .border(KlinaraMetrics.borderWidth, colors.border, shape)
                .padding(KlinaraMetrics.md),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
    ) {
        KlinaraSkeletonBar(width = 132.dp, height = 12.dp)
        Row(
            modifier = Modifier.fillMaxWidth().height(120.dp),
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalAlignment = Alignment.Bottom,
        ) {
            CHART_BAR_HEIGHTS.forEach { barHeight ->
                KlinaraSkeletonBar(
                    modifier = Modifier.weight(1f),
                    height = barHeight,
                    cornerRadius = KlinaraMetrics.xs,
                )
            }
        }
        KlinaraSkeletonBar(height = KlinaraMetrics.borderWidth, cornerRadius = 0.dp)
    }
}

/** Etiket + boş giriş alanı — form ekranlarının yer tutucusu. */
@Composable
private fun FormField(seed: Int) {
    val colors = KlinaraTheme.colors
    val labelWidths = listOf(88.dp, 112.dp, 72.dp, 96.dp)
    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        KlinaraSkeletonBar(width = labelWidths[seed.mod(4)], height = 11.dp)
        Box(
            Modifier
                .fillMaxWidth()
                .height(KlinaraMetrics.fieldHeight)
                .clip(shape)
                .background(colors.surfaceRaised)
                .border(KlinaraMetrics.borderWidth, colors.border, shape),
        )
    }
}

@KlinaraPreviews
@Composable
private fun KlinaraSkeletonCardsPreview() {
    KlinaraTheme {
        KlinaraSkeleton(
            style = KlinaraSkeletonStyle.cardsShort.withPills(),
            modifier = Modifier.padding(KlinaraMetrics.screenInset),
        )
    }
}

@KlinaraPreviews
@Composable
private fun KlinaraSkeletonReportPreview() {
    KlinaraTheme {
        KlinaraSkeleton(
            style = KlinaraSkeletonStyle.report,
            modifier = Modifier.padding(KlinaraMetrics.screenInset),
        )
    }
}

@KlinaraPreviews
@Composable
private fun KlinaraSkeletonFormPreview() {
    KlinaraTheme {
        KlinaraSkeleton(
            style = KlinaraSkeletonStyle.formShort,
            modifier = Modifier.padding(KlinaraMetrics.screenInset),
        )
    }
}

private const val DEFAULT_SECTION_ROWS = 3
private const val DEFAULT_CHIP_COUNT = 9
