package com.klinara.android.services.realtime

import com.klinara.android.services.networking.KlinaraJson
import kotlinx.serialization.Serializable

/**
 * Sunucunun anlık olay kanalından gelen sinyal — İÇERİK TAŞIMAZ.
 *
 * "Şu şubenin şu günlerinde bir randevu değişti" der; ekran veriyi yine yetkili REST
 * ucundan okur. Web paneli ve iOS ile aynı kanal (`/api/v1/realtime`) ve aynı sözleşme.
 */
sealed interface RealtimeEvent {
    /** [days]: şube saat diliminde yerel günler (`2026-09-07`). */
    data class CalendarChanged(
        val branchId: String,
        val days: List<String>,
    ) : RealtimeEvent

    data class StaffNotification(
        val kind: String,
    ) : RealtimeEvent

    /** Bağlantı koptu ve yeniden kuruldu: arada kaçan olay bilinemez, baştan oku. */
    data object Resync : RealtimeEvent
}

/** Soketten gelen tek çerçeve. Bilinmeyen tür yok sayılır — eski sürüm bozulmasın. */
internal sealed interface RealtimeFrame {
    data object Ready : RealtimeFrame

    data class Event(
        val event: RealtimeEvent,
    ) : RealtimeFrame

    companion object {
        @Serializable
        private data class Wire(
            val type: String,
            val kind: String? = null,
            val branchId: String? = null,
            val days: List<String>? = null,
        )

        fun decode(text: String): RealtimeFrame? {
            val wire = runCatching { KlinaraJson.decodeFromString(Wire.serializer(), text) }.getOrNull() ?: return null
            return when (wire.type) {
                "ready" -> Ready
                "resync" -> Event(RealtimeEvent.Resync)
                "staff_notification" -> wire.kind?.let { Event(RealtimeEvent.StaffNotification(it)) }
                "calendar_changed" -> {
                    val branchId = wire.branchId ?: return null
                    val days = wire.days ?: return null
                    Event(RealtimeEvent.CalendarChanged(branchId, days))
                }
                else -> null
            }
        }
    }
}
