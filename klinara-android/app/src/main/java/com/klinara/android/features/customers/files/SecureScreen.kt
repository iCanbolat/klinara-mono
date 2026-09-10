package com.klinara.android.features.customers.files

import android.app.Activity
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext

/**
 * Ekran görüntüsü ve son kullanılanlar önizlemesi korumasını AÇAR.
 *
 * §7.9 ve A10'un maddesi: **klinik fotoğraf ekranlarında `FLAG_SECURE` açılır.** Bir
 * hasta fotoğrafının son kullanılanlar ekranında küçük resim olarak durması ya da
 * kazara ekran görüntüsüne düşmesi, kliniğin kontrolü dışına çıkan bir sağlık verisi
 * demektir.
 *
 * Bayrak ekrandan çıkarken **kaldırılır**: uygulamanın geri kalanında ekran görüntüsü
 * meşru bir ihtiyaç (destek talebi, eğitim) ve gereksiz yere kapatmak kullanıcıyı
 * cezalandırmak olurdu.
 */
@Composable
fun SecureScreen() {
    val context = LocalContext.current

    DisposableEffect(Unit) {
        val window = (context as? Activity)?.window
        window?.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}
