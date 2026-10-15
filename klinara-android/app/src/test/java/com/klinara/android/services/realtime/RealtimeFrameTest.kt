package com.klinara.android.services.realtime

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class RealtimeFrameTest {
    @Test
    @DisplayName("Takvim çerçevesi şube ve günleri taşır")
    fun decodesCalendarFrame() {
        assertEquals(
            RealtimeFrame.Event(RealtimeEvent.CalendarChanged("b1", listOf("2026-09-07", "2026-09-08"))),
            RealtimeFrame.decode("""{"type":"calendar_changed","branchId":"b1","days":["2026-09-07","2026-09-08"]}"""),
        )
    }

    @Test
    @DisplayName("Hazır, resync ve bildirim çerçeveleri")
    fun decodesControlFrames() {
        assertEquals(RealtimeFrame.Ready, RealtimeFrame.decode("""{"type":"ready"}"""))
        assertEquals(RealtimeFrame.Event(RealtimeEvent.Resync), RealtimeFrame.decode("""{"type":"resync"}"""))
        assertEquals(
            RealtimeFrame.Event(RealtimeEvent.StaffNotification("inbound_message")),
            RealtimeFrame.decode("""{"type":"staff_notification","kind":"inbound_message"}"""),
        )
    }

    @Test
    @DisplayName("Bilinmeyen ya da eksik çerçeve yok sayılır — eski sürüm bozulmaz")
    fun ignoresUnknownFrames() {
        assertNull(RealtimeFrame.decode("""{"type":"something_new"}"""))
        assertNull(RealtimeFrame.decode("""{"type":"calendar_changed","branchId":"b1"}"""))
        assertNull(RealtimeFrame.decode("bozuk"))
    }

    @Test
    @DisplayName("Soket adresi API kökünden türetilir")
    fun socketUrl() {
        assertEquals(
            "https://api.klinara.app/api/v1/realtime",
            RealtimeClient.socketUrl("https://api.klinara.app/api/v1/".toHttpUrl()).toString(),
        )
    }
}
