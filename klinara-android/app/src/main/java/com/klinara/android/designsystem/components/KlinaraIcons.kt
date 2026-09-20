package com.klinara.android.designsystem.components

import androidx.annotation.DrawableRes
import com.klinara.android.R

/**
 * Yönetim hub'ının satır ikonları — iOS `ManagementHomeView`'daki SF Symbol seçimlerinin
 * birebir karşılığı.
 *
 * **`material-icons-extended` eklenmedi.** `libs.versions.toml`'daki "yalnız core" kararı
 * yerinde duruyor: on yedi hedefi ayırt etmek için ~1000 ikonluk bir bağımlılık taşımak
 * yerine, ihtiyaç duyulan on yedi ikon `res/drawable/ic_klinara_*.xml` olarak elde çizildi.
 * Böylece ikonlar iOS'takiyle aynı anlamı taşır ve APK'ya birkaç KB biner.
 *
 * Özellik katmanı `R.drawable` görmez; ikonu bu nesnenin adıyla ister.
 */
object KlinaraIcons {
    /** iOS: `list.bullet.rectangle` */
    @DrawableRes val services: Int = R.drawable.ic_klinara_services

    /** iOS: `folder` */
    @DrawableRes val categories: Int = R.drawable.ic_klinara_folder

    /** iOS: `person.text.rectangle` */
    @DrawableRes val staff: Int = R.drawable.ic_klinara_staff

    /** iOS: `building.2` */
    @DrawableRes val branch: Int = R.drawable.ic_klinara_branch

    /** iOS: `envelope.badge` */
    @DrawableRes val invite: Int = R.drawable.ic_klinara_invite

    /** iOS: `clock` */
    @DrawableRes val clock: Int = R.drawable.ic_klinara_clock

    /** iOS: `calendar.badge.exclamationmark` */
    @DrawableRes val calendarException: Int = R.drawable.ic_klinara_calendar_alert

    /** iOS: `tag` */
    @DrawableRes val tag: Int = R.drawable.ic_klinara_tag

    /** iOS: `shippingbox` */
    @DrawableRes val packageBox: Int = R.drawable.ic_klinara_package

    /** iOS: `tray.and.arrow.down` */
    @DrawableRes val inbox: Int = R.drawable.ic_klinara_inbox

    /** iOS: `bubble.left.and.text.bubble.right` */
    @DrawableRes val messages: Int = R.drawable.ic_klinara_messages

    /** iOS: `bell.badge` */
    @DrawableRes val reminder: Int = R.drawable.ic_klinara_bell

    /** iOS: `text.quote` */
    @DrawableRes val template: Int = R.drawable.ic_klinara_template

    /** iOS: `slider.horizontal.3` */
    @DrawableRes val preferences: Int = R.drawable.ic_klinara_sliders

    /** iOS: `link` */
    @DrawableRes val link: Int = R.drawable.ic_klinara_link

    /** iOS: `chart.line.uptrend.xyaxis` */
    @DrawableRes val reports: Int = R.drawable.ic_klinara_chart_line

    /** iOS: `chart.bar.doc.horizontal` */
    @DrawableRes val packageReports: Int = R.drawable.ic_klinara_chart_bar
}
