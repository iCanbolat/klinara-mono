package com.klinara.android.services.crm

import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/** Mock'un YAZMA yarısı sunucuyla aynı kurallara uyuyor mu. */
class MockCustomerWriteTest {
    private fun subject() = MockCustomerService(latencyEnabled = false)

    @Test
    @DisplayName("Oluşturulan müşteri listenin BAŞINDA görünür (en yeni)")
    fun createdCustomerLeadsTheList() =
        runTest {
            val service = subject()
            val created = service.create(CreateCustomerInput(fullName = "Yeni Müşteri"))

            assertEquals(created.id, service.list(CustomerListQuery(limit = 5)).data.first().id)
        }

    @Test
    @DisplayName("Telefon E.164'e normalize edilir — biçimli girdi de kabul")
    fun phoneIsNormalized() =
        runTest {
            val created = subject().create(CreateCustomerInput(fullName = "Test", phone = "0532 999 88 77"))

            assertEquals("+905329998877", created.phone)
        }

    @Test
    @DisplayName("Aynı numara İKİ kayıtta olamaz — 409")
    fun duplicatePhoneConflicts() =
        runTest {
            val service = subject()
            val existing = MockCustomers.ALL.first().phone

            val error = runCatching { service.create(CreateCustomerInput("Kopya", phone = existing)) }.exceptionOrNull()

            assertTrue(error is ApiError.Problem)
        }

    @Test
    @DisplayName("PATCH: dokunulmayan alan KORUNUR, temizlenen SİLİNİR")
    fun patchRespectsTheThreeStates() =
        runTest {
            val service = subject()
            val before = service.list(CustomerListQuery(limit = 1)).data.first()

            val after =
                service.update(
                    before.id,
                    UpdateCustomerInput(city = Patch.Set("İzmir"), notes = Patch.Clear),
                )

            assertEquals("İzmir", after.city)
            assertNull(after.notes)
            // Dokunulmayan alan yerinde: `Unchanged` gövdeye hiç yazılmadı.
            assertEquals(before.fullName, after.fullName)
            assertEquals(before.phone, after.phone)
        }

    @Test
    @DisplayName("Arşivleme kaydı DÖNDÜRÜR, listeden düşürür ve numarayı serbest bırakır")
    fun archiveFreesThePhoneNumber() =
        runTest {
            val service = subject()
            val victim = service.list(CustomerListQuery(limit = 1)).data.first()
            val phone = victim.phone

            val archived = service.archive(victim.id)

            assertEquals(victim.id, archived.id)
            assertTrue(service.list(CustomerListQuery(limit = 100)).data.none { it.id == victim.id })
            // Numara serbest kaldı: aynı numarayla yeni kayıt açılabilmeli.
            assertNotNull(service.create(CreateCustomerInput("Yeni Sahip", phone = phone)))
        }

    @Test
    @DisplayName("İkinci arşivleme 404 — silinmiş kayıt tekrar silinemez")
    fun archivingTwiceIsNotFound() =
        runTest {
            val service = subject()
            val victim = service.list(CustomerListQuery(limit = 1)).data.first()
            service.archive(victim.id)

            assertTrue(runCatching { service.archive(victim.id) }.exceptionOrNull() is ApiError.Problem)
        }

    @Test
    @DisplayName("Etiket ataması TAM DEĞİŞTİRME — gönderilmeyen düşer")
    fun replaceTagsIsAFullReplacement() =
        runTest {
            val service = subject()
            val customer = service.list(CustomerListQuery(limit = 100)).data.first { it.tags.isNotEmpty() }

            val cleared = service.replaceTags(customer.id, emptyList())

            // Boş liste "dokunma" değil "hepsini kaldır" demek.
            assertTrue(cleared.tags.isEmpty())
        }

    @Test
    @DisplayName("Etiket tekilliği KATLANMIŞ ada göre: `vıp` ile `VIP` çakışır")
    fun tagNamesAreUniqueWhenFolded() =
        runTest {
            val service = subject()

            val error = runCatching { service.createTag("vıp", null) }.exceptionOrNull()

            assertTrue(error is ApiError.Problem)
        }

    @Test
    @DisplayName("Etiket adı değişince KARTLARDAKİ rozetler de değişir")
    fun renamingATagUpdatesTheBadges() =
        runTest {
            val service = subject()
            val tag = MockCustomers.Tags.VIP

            service.updateTag(tag.id, name = "Altın üye", color = Patch.Unchanged)

            val carriers =
                service
                    .list(CustomerListQuery(limit = 100))
                    .data
                    .filter { c -> c.tags.any { it.id == tag.id } }
            assertTrue(carriers.isNotEmpty())
            // Kartta eski adı taşıyan bir kopya kalsaydı aynı etiket iki isimle görünürdü.
            assertTrue(carriers.all { c -> c.tags.first { it.id == tag.id }.name == "Altın üye" })
        }

    @Test
    @DisplayName("Etiket silinince atamalar da düşer")
    fun deletingATagRemovesAssignments() =
        runTest {
            val service = subject()
            val tag = MockCustomers.Tags.VIP

            service.deleteTag(tag.id)

            assertTrue(service.tags().none { it.id == tag.id })
            assertTrue(service.list(CustomerListQuery(limit = 100)).data.all { c -> c.tags.none { it.id == tag.id } })
        }

    @Test
    @DisplayName("Birleştirme VERİ KAZANDIRIR: hedefin boş alanı kaynaktan dolar")
    fun mergeFillsGapsFromTheSource() =
        runTest {
            val service = subject()
            val all = service.list(CustomerListQuery(limit = 100)).data
            // "Elif Demir" telefonsuz; telefonlu bir kaydı ona birleştirince numara gelmeli.
            val target = all.first { it.phone == null }
            val source = all.first { it.phone != null }

            val result = service.merge(target.id, source.id)

            assertEquals(source.phone, result.customer.phone)
            // Hedefin DOLU alanı korunur — birleştirme veri kaybı işlemi değildir.
            assertEquals(target.fullName, result.customer.fullName)
        }

    @Test
    @DisplayName("Birleştirmede etiketler BİRLEŞİR ve tekilleşir")
    fun mergeUnionsTags() =
        runTest {
            val service = subject()
            val all = service.list(CustomerListQuery(limit = 100)).data
            val target = all.first { it.tags.any { tag -> tag.id == MockCustomers.Tags.VIP.id } }
            val source = all.first { it.id != target.id && it.tags.isNotEmpty() }

            val merged = service.merge(target.id, source.id).customer

            val expected = (target.tags + source.tags).map { it.id }.toSet()
            assertEquals(expected, merged.tags.map { it.id }.toSet())
            assertEquals(merged.tags.size, merged.tags.map { it.id }.toSet().size)
        }

    @Test
    @DisplayName("Birleştirilen kaynak kayıt listeden düşer")
    fun mergeArchivesTheSource() =
        runTest {
            val service = subject()
            val all = service.list(CustomerListQuery(limit = 100)).data
            val (target, source) = all[0] to all[1]

            service.merge(target.id, source.id)

            assertTrue(service.list(CustomerListQuery(limit = 100)).data.none { it.id == source.id })
        }

    @Test
    @DisplayName("Kendine birleştirme REDDEDİLİR — sunucu da 400 veriyor")
    fun selfMergeIsRejected() =
        runTest {
            val service = subject()
            val victim = service.list(CustomerListQuery(limit = 1)).data.first()

            val error = runCatching { service.merge(victim.id, victim.id) }.exceptionOrNull()

            assertTrue(error is ApiError.Problem)
            assertFalse((error as ApiError.Problem).fieldErrors.isEmpty())
        }
}
