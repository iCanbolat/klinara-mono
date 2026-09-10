package com.klinara.android.features.auth.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraWordmark
import com.klinara.android.features.auth.AuthErrorState
import com.klinara.android.features.auth.AuthEvent

/**
 * Oturum diskten çözülürken görünen marka ekranı.
 *
 * Normalde göz açıp kapayana kadar geçer — `core-splashscreen` bu adımı örter. Ama
 * sunucuya ulaşılamadığında bu ekranda KALINIR: geçici bir ağ hatası yüzünden geçerli
 * bir oturumu atıp kullanıcıyı yeniden giriş yapmaya zorlamak yerine, tekrar deneme
 * sunulur.
 */
@Composable
fun LaunchScreen(
    modifier: Modifier = Modifier,
    error: AuthErrorState? = null,
    onEvent: (AuthEvent) -> Unit = {},
    onOpenDeveloperMenu: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(KlinaraMetrics.screenInset),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Geliştirici menüsü buradan da açılabilmeli (yalnız debug): sunucu
        // ulaşılamazken bu ekranda kalınıyor ve başka giriş noktası olmazsa
        // geliştirici mock senaryolarına geçemez — kapana kısılır.
        KlinaraWordmark(
            modifier =
                if (onOpenDeveloperMenu != null) {
                    Modifier.pointerInput(Unit) {
                        detectTapGestures(onLongPress = { onOpenDeveloperMenu() })
                    }
                } else {
                    Modifier
                },
        )

        if (error != null) {
            Column(
                modifier = Modifier.padding(top = KlinaraMetrics.sectionGap),
                verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
            ) {
                ErrorBanner(message = error.message, supportReference = error.supportReference)
                KlinaraButton(
                    title = "Tekrar dene",
                    onClick = { onEvent(AuthEvent.RetrySessionRestore) },
                )
            }
        }
    }
}

@KlinaraPreviews
@Composable
private fun LaunchScreenPreview() {
    KlinaraTheme {
        LaunchScreen(error = AuthErrorState("Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin."))
    }
}
