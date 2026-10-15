package com.klinara.android.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.services.push.PushRouter

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Sistem splash'i `super.onCreate`'ten ÖNCE kurulmalı.
        //
        // Oturum diskten çözülene kadar açık kalır; böylece geçerli oturumu olan
        // kullanıcı ne LaunchScreen parlaması ne de boş bir kare görür. Oturumu
        // olmayanda ViewModel zaten 450 ms bekliyor (AuthFlowViewModel.SPLASH_SETTLE_MILLIS).
        val splash = installSplashScreen()
        var resolvingSession = true
        splash.setKeepOnScreenCondition { resolvingSession }

        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Kapalı uygulama bildirime dokunularak açıldı.
        if (savedInstanceState == null) PushRouter.handle(intent)

        setContent {
            KlinaraTheme {
                RootContent(onSessionResolved = { resolvingSession = false })
            }
        }
    }

    /** Açık uygulamada bildirime dokunuldu (`FLAG_ACTIVITY_SINGLE_TOP`). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        PushRouter.handle(intent)
    }
}
