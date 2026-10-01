package com.klinara.android.features.branches

import com.klinara.android.services.branches.BranchDetail
import com.klinara.android.services.branches.BranchMapsLink
import com.klinara.android.services.branches.BranchSlug
import com.klinara.android.services.branches.MockBranchesService
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockIds
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class BranchFeatureTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private val bodrum =
        BranchDetail(id = "b2", slug = "bodrum", name = "Bodrum", phone = "+90252", address = "Neyzen Tevfik")

    @Test
    @DisplayName("Kod addan önerilir; alana dokunulunca öneri durur")
    fun slugSuggestion() {
        assertEquals("izmir-alsancak", BranchSlug.suggest("İzmir Alsancak"))
        assertEquals("nisantasi-sisli", BranchSlug.suggest("  Nişantaşı / Şişli "))
        assertEquals("cesme-g-uskudar-o", BranchSlug.suggest("Çeşme Ğ Üsküdar Ö"))

        val touched = BranchDraft().withName("İzmir").withSlug("IZM-1").withName("İzmir Alsancak")
        assertEquals("izm-1", touched.slug)
        assertFalse(BranchSlug.isValid("iz"))
        assertFalse(BranchSlug.isValid("izmir--alsancak"))
    }

    @Test
    @DisplayName("PATCH yalnız değişen alanı taşır; boşaltılan telefon TEMİZLENİR; pasife alma işaretlenir")
    fun updateDiff() {
        val draft = BranchDraft(original = bodrum).copy(phone = " ", isActive = false)
        val input = draft.updateInput(bodrum)

        assertNull(input.name)
        assertEquals(Patch.Clear, input.phone)
        assertEquals(Patch.Unchanged, input.address)
        assertEquals(false, input.isActive)
        assertTrue(draft.deactivates)
        assertFalse(BranchDraft(original = bodrum).isDirty)
    }

    @Test
    @DisplayName("Pasife alma kaydı ÖNCE onay ister; onaydan sonra kaydedilir")
    fun deactivationNeedsConfirmation() =
        runTest(dispatcher) {
            val model = BranchEditorViewModel(MockBranchesService(latencyEnabled = false), MockIds.BRANCH_BODRUM)
            model.load()
            advanceUntilIdle()

            model.update { it.copy(isActive = false) }
            model.save()
            advanceUntilIdle()
            assertTrue(model.state.value.confirmsDeactivation)
            assertNull(model.state.value.saved)

            model.confirmSave()
            advanceUntilIdle()
            assertEquals(false, model.state.value.saved?.isActive)
        }

    @Test
    @DisplayName("Aynı kodla ikinci şube 409 — mesaj ekranda, kayıt yok")
    fun duplicateSlug() =
        runTest(dispatcher) {
            val model = BranchEditorViewModel(MockBranchesService(latencyEnabled = false), null)
            model.update { it.withName("Nişantaşı") }
            model.save()
            advanceUntilIdle()

            assertNotNull(model.state.value.error)
            assertNull(model.state.value.saved)
        }

    @Test
    @DisplayName("Liste sırası: aktifler önce, sonra ada göre")
    fun ordering() {
        val sorted =
            sortedBranches(
                listOf(
                    bodrum.copy(id = "z", name = "Zeytinburnu", isActive = false),
                    bodrum.copy(id = "k", name = "Kadıköy"),
                    bodrum,
                ),
            )
        assertEquals(listOf("b2", "k", "z"), sorted.map { it.id })
    }

    @Test
    @DisplayName("Google Maps bağlantısı yalnız https kabul eder; boşluklu ya da http bağlantı reddedilir")
    fun mapsLinkMustBeHttps() {
        assertTrue(BranchMapsLink.isValid("https://maps.app.goo.gl/abc123"))
        assertFalse(BranchMapsLink.isValid("http://maps.app.goo.gl/abc123"))
        assertFalse(BranchMapsLink.isValid("https://maps.app.goo.gl/a b"))
        assertFalse(BranchMapsLink.isValid("maps.app.goo.gl/abc"))
    }

    @Test
    @DisplayName("Bağlantı taslağı: geçersizse kaydedilemez, değişince yalnız o alan yamalanır, boşaltınca temizlenir")
    fun mapsLinkDraft() {
        val original = bodrum.copy(mapsUrl = "https://maps.app.goo.gl/eski")
        val draft = BranchDraft(original)
        assertFalse(draft.isDirty)

        val edited = draft.copy(mapsUrl = "http://guvensiz")
        assertNotNull(edited.mapsUrlError)
        assertFalse(edited.isValid)

        val changed = draft.copy(mapsUrl = "https://maps.app.goo.gl/yeni")
        assertTrue(changed.isValid)
        assertEquals(Patch.text("https://maps.app.goo.gl/yeni"), changed.updateInput(original).mapsUrl)
        assertEquals(Patch.Unchanged, changed.updateInput(original).phone)

        assertEquals(Patch.text(""), draft.copy(mapsUrl = "").updateInput(original).mapsUrl)
    }
}
