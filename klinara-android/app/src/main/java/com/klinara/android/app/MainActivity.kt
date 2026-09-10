package com.klinara.android.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.klinara.android.designsystem.KlinaraTheme

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

        setContent {
            KlinaraTheme {
                RootContent(onSessionResolved = { resolvingSession = false })
            }
        }
    }
}
