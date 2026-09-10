package com.klinara.android.designsystem

import android.content.res.Configuration.UI_MODE_NIGHT_YES
import androidx.compose.ui.tooling.preview.Preview

/**
 * Her bileşen için tek annotation. Karanlık tema İLK GÜNDEN gözden geçirilir —
 * sonradan eklenen karanlık tema her ekranda tek tek düzeltme demektir (§6 A0.2).
 * `fontScale = 2.0` A10'un erişilebilirlik denetimini batch'e öne çeker.
 */
@Preview(name = "Açık", showBackground = true, backgroundColor = 0xFFFAF8F5)
@Preview(name = "Koyu", showBackground = true, backgroundColor = 0xFF161917, uiMode = UI_MODE_NIGHT_YES)
@Preview(name = "Büyük yazı", showBackground = true, backgroundColor = 0xFFFAF8F5, fontScale = 2.0f)
annotation class KlinaraPreviews
