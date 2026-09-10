package com.klinara.android.features.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.profile.ProfileScreen
import com.klinara.android.services.ServiceContainer

/**
 * Oturum açıldıktan sonraki uygulama kabuğu.
 *
 * Giriş akışı bir durum makinesiydi ve öyle kalır (§5.3): `RootScreen`'in `when`
 * dispatch'ine dokunulmadı, yalnız `AuthStep.Authenticated` dalı buraya bağlandı.
 * **Kabuğun içi ise normal Android gezinmesidir**: her sekmenin kendi `NavHost`'u ve
 * kendi geri yığını var. Sekme değiştirip geri gelince kaldığı yerde bulmak Android'de
 * beklenen davranıştır.
 *
 * A2'de her grafiğin tek hedefi var. Yığınları şimdi kurmanın sebebi, A3–A9 sekme içi
 * ekran eklerken kabuğun yeniden yazılmaması.
 */
@Composable
fun AppShell(
    initialSession: AppSession,
    container: ServiceContainer,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
    onOpenDeveloperMenu: (() -> Unit)? = null,
) {
    val sessionViewModel: SessionViewModel =
        viewModel(
            // Oturum kimliği anahtar: kullanıcı değişince (çıkış → yeni giriş) yeni bir
            // ViewModel kurulur ve önceki kullanıcının profili sızmaz.
            key = "session-${initialSession.profile.user.id}",
            factory = SessionViewModel.factory(initialSession, container),
        )
    val session by sessionViewModel.session.collectAsStateWithLifecycle()

    val tabs = ShellTab.visibleFor(session)
    var selectedName by rememberSaveable { mutableStateOf(ShellTab.Today.name) }
    // İzinler `reloadProfile` ile daralabilir; seçili sekme kaybolursa ilkine düşülür.
    val selected = tabs.firstOrNull { it.name == selectedName } ?: tabs.first()

    val todayNav = rememberNavController()
    val customersNav = rememberNavController()
    val managementNav = rememberNavController()
    val profileNav = rememberNavController()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        // Zemin KlinaraTheme'in tam kanamalı Surface'inden gelir; Scaffold'un kendi
        // zeminini boyaması sistem çubuklarının arkasını yeniden kaplardı (A0.2).
        containerColor = Color.Transparent,
        contentColor = KlinaraTheme.colors.charcoal,
        bottomBar = {
            ShellNavigationBar(
                tabs = tabs,
                selected = selected,
                onSelect = { selectedName = it.name },
            )
        },
    ) { innerPadding ->
        Box(modifier = Modifier.padding(bottom = innerPadding.calculateBottomPadding())) {
            val branchMenu: @Composable RowScope.() -> Unit = {
                BranchMenu(session = session, onSelect = sessionViewModel::switchBranch)
            }

            when (selected) {
                ShellTab.Today -> TodayTab(todayNav, session, branchMenu)
                ShellTab.Customers -> CustomersTab(customersNav, branchMenu)
                ShellTab.Management -> ManagementTab(managementNav, branchMenu)
                ShellTab.Profile ->
                    ProfileTab(
                        navController = profileNav,
                        session = session,
                        container = container,
                        onEvent = onEvent,
                        onOpenDeveloperMenu = onOpenDeveloperMenu,
                        trailing = branchMenu,
                    )
            }
        }
    }
}

@Composable
private fun TodayTab(
    navController: NavHostController,
    session: AppSession,
    trailing: @Composable RowScope.() -> Unit,
) {
    NavHost(navController = navController, startDestination = ShellRoutes.TodayHome) {
        composable<ShellRoutes.TodayHome> {
            if (ShellTab.canSeeCalendar(session)) {
                ComingSoonScreen(
                    title = "Bugün",
                    headline = "Takvim hazırlanıyor",
                    message =
                        "Randevu takvimi Faz A3 ile geliyor. Şimdilik Yönetim sekmesinden " +
                            "kurulum yapabilirsiniz.",
                    icon = Icons.Filled.DateRange,
                    trailing = trailing,
                )
            } else {
                // Sekme duruyor ama içerik dürüst: `accountant` rolünde hiç randevu
                // izni yok ve varsayılan sekmenin role göre kaybolması bilgi
                // mimarisini role göre değiştirmek olurdu.
                KlinaraScreen(title = "Bugün", trailing = trailing) {
                    EmptyStateView(
                        title = "Takvim erişiminiz yok",
                        message = "Rolünüz randevuları görüntülemeyi kapsamıyor.",
                        icon = Icons.Filled.DateRange,
                    )
                }
            }
        }
    }
}

@Composable
private fun CustomersTab(
    navController: NavHostController,
    trailing: @Composable RowScope.() -> Unit,
) {
    NavHost(navController = navController, startDestination = ShellRoutes.CustomerList) {
        composable<ShellRoutes.CustomerList> {
            ComingSoonScreen(
                title = "Müşteriler",
                headline = "Müşteri kartı hazırlanıyor",
                message = "Liste, arama, notlar ve fotoğraflar Faz A4 ile geliyor.",
                icon = Icons.Filled.Person,
                trailing = trailing,
            )
        }
    }
}

@Composable
private fun ManagementTab(
    navController: NavHostController,
    trailing: @Composable RowScope.() -> Unit,
) {
    NavHost(navController = navController, startDestination = ShellRoutes.ManagementHome) {
        composable<ShellRoutes.ManagementHome> {
            // Gerçek hub (katalog, personel, çalışma saatleri, kasa, prim) Faz A7'de.
            ComingSoonScreen(
                title = "Yönetim",
                headline = "Kurulum ekranları hazırlanıyor",
                message =
                    "Hizmetler, ekip ve çalışma saatleri Faz A7 ile; kasa ve prim Faz A6 ile geliyor.",
                icon = Icons.Filled.Settings,
                trailing = trailing,
            )
        }
    }
}

@Composable
private fun ProfileTab(
    navController: NavHostController,
    session: AppSession,
    container: ServiceContainer,
    onEvent: (AuthEvent) -> Unit,
    onOpenDeveloperMenu: (() -> Unit)?,
    trailing: @Composable RowScope.() -> Unit,
) {
    NavHost(navController = navController, startDestination = ShellRoutes.ProfileHome) {
        composable<ShellRoutes.ProfileHome> {
            ProfileScreen(
                session = session,
                container = container,
                onEvent = onEvent,
                onOpenDeveloperMenu = onOpenDeveloperMenu,
                trailing = trailing,
            )
        }
    }
}

/**
 * Alt gezinme çubuğu.
 *
 * Material3 `NavigationBar` **taşıyıcı olarak** kullanılıyor (§5.6): seçili sekmenin
 * ekran okuyucuya `Tab` rolüyle ve "seçili" durumuyla duyurulması, kendi `Row`'umuzu
 * yazsaydık elle kurmamız gereken bir şeydi. Renkler token'lardan geliyor.
 */
@Composable
private fun ShellNavigationBar(
    tabs: List<ShellTab>,
    selected: ShellTab,
    onSelect: (ShellTab) -> Unit,
) {
    val colors = KlinaraTheme.colors
    NavigationBar(
        containerColor = colors.surfaceRaised,
        contentColor = colors.charcoal,
        tonalElevation = 0.dp,
    ) {
        tabs.forEach { tab ->
            NavigationBarItem(
                selected = tab == selected,
                onClick = { onSelect(tab) },
                icon = {
                    // İkon dekoratif: etiket zaten sekmenin adını söylüyor ve
                    // NavigationBarItem seçili durumu kendisi duyuruyor.
                    Icon(tab.icon, contentDescription = null)
                },
                label = {
                    Text(
                        tab.label,
                        style = KlinaraType.label,
                        // fontScale 2.0'da dört sekme yan yana sığmaz; kırpmak
                        // sarmaktan iyidir çünkü ikon ve seçili durum zaten anlamı taşıyor.
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                colors =
                    NavigationBarItemDefaults.colors(
                        selectedIconColor = colors.sageDeep,
                        selectedTextColor = colors.sageDeep,
                        indicatorColor = colors.sageSoft,
                        unselectedIconColor = colors.charcoalMuted,
                        unselectedTextColor = colors.charcoalMuted,
                    ),
            )
        }
    }
}
