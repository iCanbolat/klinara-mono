package com.klinara.android.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Yalnız debug: dokuz bileşenin tek ekranda hâlleri.
 *
 * A0.3'ün "Bitti" ölçütü buradan doğrulanır — açık/koyu tema, `fontScale 2.0`,
 * TalkBack ile forma girilebilirlik ve 48dp dokunma hedefleri.
 */
@Composable
fun ComponentGalleryScreen(modifier: Modifier = Modifier) {
    val colors = KlinaraTheme.colors
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("gizli-parola") }
    var phone by remember { mutableStateOf("") }
    var otp by remember { mutableStateOf("") }
    var sessions by remember { mutableStateOf(3) }
    var priceMinor by remember { mutableStateOf<Long?>(1_250_000L) }
    var transferable by remember { mutableStateOf(true) }
    var picked by remember { mutableStateOf("Lazer epilasyon") }
    var specialties by remember { mutableStateOf(listOf("Lazer", "Dolgu")) }
    var opening by remember { mutableStateOf(java.time.LocalTime.of(9, 0)) }
    var leaveDate by remember { mutableStateOf(java.time.LocalDate.of(2026, 9, 17)) }

    AuthScaffold(
        modifier = modifier.fillMaxSize(),
        eyebrow = "Tasarım sistemi",
        title = "Bileşenler",
        subtitle = "A0.3'ün dokuz bileşeni, gerçek etkileşimle.",
        showsLogo = true,
        onBack = {},
        actions = {
            KlinaraButton(title = "Devam et", onClick = {})
            KlinaraButton(title = "Daha sonra", onClick = {}, kind = KlinaraButtonKind.Tertiary)
        },
    ) {
        SectionLabel("Butonlar")
        KlinaraButton(title = "Devam et", onClick = {})
        KlinaraButton(
            title = "Parmak izi ile giriş",
            onClick = {},
            kind = KlinaraButtonKind.Secondary,
            icon = Icons.Filled.Lock,
        )
        KlinaraButton(title = "Daha sonra", onClick = {}, kind = KlinaraButtonKind.Tertiary)
        KlinaraButton(title = "Gönderiliyor", onClick = {}, isLoading = true)
        KlinaraButton(title = "Devam et", onClick = {}, enabled = false)

        SectionLabel("Alanlar")
        KlinaraTextField(
            label = "E-posta",
            value = email,
            onValueChange = { email = it },
            placeholder = "ornek@klinik.com",
        )
        KlinaraTextField(
            label = "Parola",
            value = password,
            onValueChange = { password = it },
            error = "Girdiğiniz bilgiler hatalı.",
            isSecure = true,
        )
        PhoneNumberField(label = "Telefon numarası", e164 = phone, onE164Change = { phone = it })

        SectionLabel("Doğrulama kodu")
        OtpCodeField(code = otp, onCodeChange = { otp = it })

        SectionLabel("Hata ve rozet")
        ErrorBanner(
            message = "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.",
            onRetry = {},
        )
        ErrorBanner(
            message = "Beklenmeyen bir hata oluştu.",
            supportReference = "req_8f3a91",
        )
        Row(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
            KlinaraBadge("Onaylandı", tone = KlinaraBadgeTone.Positive)
            KlinaraBadge("Bekliyor", tone = KlinaraBadgeTone.Neutral)
            KlinaraBadge("İptal", tone = KlinaraBadgeTone.Warning)
            KlinaraBadge("Geçmiş", tone = KlinaraBadgeTone.Muted)
        }

        SectionLabel("Kart ve satırlar")
        KlinaraCard(title = "Randevu", footnote = "Şube saatiyle gösterilir.") {
            KlinaraRow(label = "Müşteri", value = "Ayşe Yılmaz")
            KlinaraDivider()
            KlinaraRow(label = "Hizmet", value = "Cilt bakımı", detail = "45 dk")
            KlinaraDivider()
            KlinaraNavigationRow(label = "Geçmişi gör", onClick = {}, value = "3 kayıt")
        }

        // A5.1 — paket formlarıyla doğanlar.
        SectionLabel("Adımlayıcı, tutar, anahtar")
        KlinaraCard {
            KlinaraStepperRow(
                label = "Lazer epilasyon",
                value = sessions,
                onValueChange = { sessions = it },
                range = 1..10,
                detail = "Alt ve üst sınırda düğme pasifleşir",
                format = { "$it seans" },
            )
            KlinaraDivider()
            KlinaraMoneyField(
                label = "Satış fiyatı",
                valueMinor = priceMinor,
                onValueChange = { priceMinor = it },
                parse = com.klinara.android.services.formatting.Money::parse,
                format = com.klinara.android.services.formatting.Money::formatPlain,
            )
            KlinaraToggleRow(
                label = "Devredilebilir",
                detail = "Kalan hak başka müşteriye aktarılabilir",
                isOn = transferable,
                onToggle = { transferable = it },
            )
        }

        // A7.2 — personelin uzmanlıkları.
        SectionLabel("Etiket alanı")
        KlinaraCard {
            KlinaraTagField(label = "Uzmanlıklar", tags = specialties, onTagsChange = { specialties = it })
        }

        // A7.3 — çalışma saatleri ve istisnalar.
        SectionLabel("Saat ve tarih")
        KlinaraCard {
            KlinaraTimeField(label = "Açılış", value = opening, onValueChange = { opening = it })
            KlinaraDateField(label = "Başlangıç", value = leaveDate, onValueChange = { leaveDate = it })
        }

        SectionLabel("Rapor dönemi")
        ReportPeriodBar(label = "1 Eylül 2026 – 30 Eylül 2026", onShift = {})

        SectionLabel("Grafik")
        KlinaraCard {
            KlinaraChart(
                kind = KlinaraChartKind.Bar,
                points =
                    listOf(
                        KlinaraChartPoint("1", "Derya Aksoy", 62.5),
                        KlinaraChartPoint("2", "Merve Tunç", 48.15),
                        KlinaraChartPoint("3", "Onur Bayrak", 12.0),
                    ),
                format = { "%${it.toInt()}" },
            )
        }

        SectionLabel("Seçim listesi")
        KlinaraCard {
            KlinaraSearchablePicker(
                options = listOf("Cilt bakımı", "Lazer epilasyon", "Dolgu", "Kontrol", "Maske", "Peeling"),
                key = { it },
                label = { it },
                isSelected = { it == picked },
                onSelect = { picked = it },
                searchLabel = "Hizmet ara",
            )
        }
    }
}

@Composable
private fun SectionLabel(title: String) {
    Text(
        KlinaraType.labelText(title),
        style = KlinaraType.label,
        color = KlinaraTheme.colors.charcoalMuted,
        modifier = Modifier.fillMaxWidth().padding(top = KlinaraMetrics.md),
    )
}

@KlinaraPreviews
@Composable
private fun ComponentGalleryPreview() {
    KlinaraTheme { ComponentGalleryScreen() }
}
