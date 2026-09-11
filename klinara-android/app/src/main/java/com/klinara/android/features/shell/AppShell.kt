package com.klinara.android.features.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.navigation.toRoute
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.calendar.AppointmentDetailScreen
import com.klinara.android.features.calendar.AppointmentHistoryScreen
import com.klinara.android.features.calendar.CalendarHomeScreen
import com.klinara.android.features.customers.CustomerDetailScreen
import com.klinara.android.features.customers.CustomerEditorScreen
import com.klinara.android.features.customers.CustomerListScreen
import com.klinara.android.features.customers.CustomerMergeScreen
import com.klinara.android.features.customers.CustomerTagListScreen
import com.klinara.android.features.customers.NoteEditorHost
import com.klinara.android.features.customers.NoteRevisionsHost
import com.klinara.android.features.customers.files.DocumentPreviewHost
import com.klinara.android.features.customers.files.FileUploadHost
import com.klinara.android.features.customers.files.PhotoDetailHost
import com.klinara.android.features.customers.files.PhotoGroupsHost
import com.klinara.android.services.files.FilePosition
import com.klinara.android.features.calendar.booking.BookingFlowHost
import com.klinara.android.features.packages.BindPackageHost
import com.klinara.android.features.packages.CustomerPackageDetailHost
import com.klinara.android.features.packages.PackageOperation
import com.klinara.android.features.packages.PackageOperationHost
import com.klinara.android.features.packages.PackageReportScreen
import com.klinara.android.features.packages.PackageReportsHost
import com.klinara.android.features.packages.PackageDefinitionEditorScreen
import com.klinara.android.features.packages.PackageDefinitionListScreen
import com.klinara.android.features.packages.SellPackageHost
import com.klinara.android.features.profile.ProfileScreen
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions

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
    // Şube değişimi sayacının İLK tüketicisi (A2.1'de kurulmuştu): takvim, şube
    // değiştiğinde aynı gün için YENİDEN istek atmak zorunda — yalnız `activeBranchId`
    // izlense, aynı şubeye geri dönüldüğünde bayat veri ekranda kalırdı.
    val branchGeneration by sessionViewModel.branchGeneration.collectAsStateWithLifecycle()

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
                ShellTab.Today -> TodayTab(todayNav, session, container, branchGeneration, branchMenu)
                ShellTab.Customers -> CustomersTab(customersNav, session, container, branchMenu)
                ShellTab.Management -> ManagementTab(managementNav, session, container, branchMenu)
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
    container: ServiceContainer,
    branchGeneration: Int,
    trailing: @Composable RowScope.() -> Unit,
) {
    NavHost(navController = navController, startDestination = ShellRoutes.TodayHome) {
        composable<ShellRoutes.TodayHome> {
            if (ShellTab.canSeeCalendar(session)) {
                CalendarHomeScreen(
                    session = session,
                    container = container,
                    branchGeneration = branchGeneration,
                    onSelectAppointment = { navController.navigate(ShellRoutes.AppointmentDetail(it)) },
                    // Giriş noktası izne bağlı (§7.4): `appointment:write` yoksa
                    // "+" düğmesi HİÇ çizilmez, 403 ile karşılaşılmaz.
                    onCreate =
                        if (session.can(Permissions.APPOINTMENT_WRITE)) {
                            { navController.navigate(ShellRoutes.BookingFlow()) }
                        } else {
                            null
                        },
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

        composable<ShellRoutes.AppointmentDetail> { entry ->
            val route = entry.toRoute<ShellRoutes.AppointmentDetail>()
            AppointmentDetailScreen(
                appointmentId = route.appointmentId,
                session = session,
                container = container,
                onBack = { navController.popBackStack() },
                onOpenHistory = { navController.navigate(ShellRoutes.AppointmentHistory(it)) },
                onReschedule = { navController.navigate(ShellRoutes.BookingFlow(rescheduleId = it)) },
                onBindPackage =
                    if (session.can(Permissions.PACKAGE_WRITE)) {
                        { appointment, line -> navController.navigate(ShellRoutes.BindPackage(appointment, line)) }
                    } else {
                        null
                    },
            )
        }

        composable<ShellRoutes.BindPackage> { entry ->
            val route = entry.toRoute<ShellRoutes.BindPackage>()
            BindPackageHost(
                session = session,
                container = container,
                appointmentId = route.appointmentId,
                appointmentServiceId = route.appointmentServiceId,
                serviceName = null,
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.BookingFlow> { entry ->
            val route = entry.toRoute<ShellRoutes.BookingFlow>()
            BookingFlowHost(
                rescheduleId = route.rescheduleId,
                session = session,
                container = container,
                onBack = { navController.popBackStack() },
                onCreated = {
                    // Oluşturduktan sonra takvime dönülür ve YENİ randevu orada görünür.
                    // Detaya atlamak, kullanıcıyı yeni bir ekrana bırakıp "peki günün
                    // geri kalanı?" sorusunu cevapsız bırakırdı.
                    navController.popBackStack()
                },
            )
        }

        composable<ShellRoutes.AppointmentHistory> { entry ->
            val route = entry.toRoute<ShellRoutes.AppointmentHistory>()
            AppointmentHistoryScreen(
                appointmentId = route.appointmentId,
                session = session,
                container = container,
                onBack = { navController.popBackStack() },
            )
        }
    }
}

@Composable
private fun CustomersTab(
    navController: NavHostController,
    session: AppSession,
    container: ServiceContainer,
    trailing: @Composable RowScope.() -> Unit,
) {
    NavHost(navController = navController, startDestination = ShellRoutes.CustomerList) {
        composable<ShellRoutes.CustomerList> {
            CustomerListScreen(
                session = session,
                container = container,
                onSelectCustomer = { navController.navigate(ShellRoutes.CustomerDetail(it)) },
                onCreateCustomer =
                    if (session.can(Permissions.CUSTOMER_WRITE)) {
                        { navController.navigate(ShellRoutes.CustomerEditor()) }
                    } else {
                        null
                    },
                trailing = trailing,
            )
        }

        composable<ShellRoutes.CustomerDetail> { entry ->
            val route = entry.toRoute<ShellRoutes.CustomerDetail>()
            CustomerDetailScreen(
                session = session,
                container = container,
                customerId = route.customerId,
                onBack = { navController.popBackStack() },
                onEdit = { navController.navigate(ShellRoutes.CustomerEditor(it)) },
                onMerge = { navController.navigate(ShellRoutes.CustomerMerge(it)) },
                onOpenNote = { customer, note ->
                    navController.navigate(ShellRoutes.NoteEditor(customer, note))
                },
                onOpenPhoto = { customer, fileId ->
                    navController.navigate(ShellRoutes.PhotoDetail(customer, fileId))
                },
                onOpenDocument = { customer, fileId ->
                    navController.navigate(ShellRoutes.DocumentPreview(customer, fileId))
                },
                onOpenGroups = { navController.navigate(ShellRoutes.PhotoGroups(it)) },
                onUploadFile = { customer, isPhoto ->
                    navController.navigate(ShellRoutes.FileUpload(customer, isPhoto))
                },
                onOpenPackage = { navController.navigate(ShellRoutes.CustomerPackageDetail(it)) },
                onSellPackage =
                    if (session.can(Permissions.PACKAGE_WRITE)) {
                        { navController.navigate(ShellRoutes.SellPackage(it)) }
                    } else {
                        null
                    },
            )
        }

        composable<ShellRoutes.SellPackage> { entry ->
            val route = entry.toRoute<ShellRoutes.SellPackage>()
            SellPackageHost(
                session = session,
                container = container,
                customerId = route.customerId,
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.CustomerPackageDetail> { entry ->
            val route = entry.toRoute<ShellRoutes.CustomerPackageDetail>()
            CustomerPackageDetailHost(
                session = session,
                container = container,
                packageId = route.packageId,
                onOperation = { operation ->
                    navController.navigate(ShellRoutes.PackageOperation(route.packageId, operation.wire))
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.PackageOperation> { entry ->
            val route = entry.toRoute<ShellRoutes.PackageOperation>()
            PackageOperationHost(
                session = session,
                container = container,
                packageId = route.packageId,
                operation = PackageOperation.from(route.operation),
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.FileUpload> { entry ->
            val route = entry.toRoute<ShellRoutes.FileUpload>()
            FileUploadHost(
                container = container,
                customerId = route.customerId,
                isPhoto = route.isPhoto,
                groupId = route.groupId,
                position = route.position?.let(FilePosition::from),
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.PhotoGroups> { entry ->
            val route = entry.toRoute<ShellRoutes.PhotoGroups>()
            PhotoGroupsHost(
                session = session,
                container = container,
                customerId = route.customerId,
                onOpenPhoto = { navController.navigate(ShellRoutes.PhotoDetail(route.customerId, it)) },
                onAddToSlot = { groupId, position ->
                    // Grup ve konum önceden seçili gidiyor: yükleme ekranı bir daha sormaz.
                    navController.navigate(
                        ShellRoutes.FileUpload(
                            customerId = route.customerId,
                            isPhoto = true,
                            groupId = groupId,
                            position = position.wire,
                        ),
                    )
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.PhotoDetail> { entry ->
            val route = entry.toRoute<ShellRoutes.PhotoDetail>()
            PhotoDetailHost(
                session = session,
                container = container,
                customerId = route.customerId,
                fileId = route.fileId,
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.DocumentPreview> { entry ->
            val route = entry.toRoute<ShellRoutes.DocumentPreview>()
            DocumentPreviewHost(
                container = container,
                customerId = route.customerId,
                fileId = route.fileId,
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.NoteEditor> { entry ->
            val route = entry.toRoute<ShellRoutes.NoteEditor>()
            NoteEditorHost(
                session = session,
                container = container,
                customerId = route.customerId,
                noteId = route.noteId,
                onBack = { navController.popBackStack() },
                onOpenRevisions = { customer, note ->
                    navController.navigate(ShellRoutes.NoteRevisions(customer, note))
                },
            )
        }

        composable<ShellRoutes.NoteRevisions> { entry ->
            val route = entry.toRoute<ShellRoutes.NoteRevisions>()
            NoteRevisionsHost(
                session = session,
                container = container,
                customerId = route.customerId,
                noteId = route.noteId,
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.CustomerEditor> { entry ->
            val route = entry.toRoute<ShellRoutes.CustomerEditor>()
            CustomerEditorScreen(
                container = container,
                customerId = route.customerId,
                onBack = { navController.popBackStack() },
                onSaved = { saved ->
                    // Yeni kayıt kartına GİDER, düzenleme geri döner. Yeni müşteriyi
                    // kaydedip listeye düşmek, kullanıcıyı az önce yarattığı kaydı
                    // aramaya zorlardı.
                    if (route.customerId == null) {
                        navController.navigate(ShellRoutes.CustomerDetail(saved.id)) {
                            popUpTo(ShellRoutes.CustomerList)
                        }
                    } else {
                        navController.popBackStack()
                    }
                },
            )
        }

        composable<ShellRoutes.CustomerMerge> { entry ->
            val route = entry.toRoute<ShellRoutes.CustomerMerge>()
            CustomerMergeScreen(
                container = container,
                targetCustomerId = route.customerId,
                onBack = { navController.popBackStack() },
            )
        }
    }
}

@Composable
private fun ManagementTab(
    navController: NavHostController,
    session: AppSession,
    container: ServiceContainer,
    trailing: @Composable RowScope.() -> Unit,
) {
    NavHost(navController = navController, startDestination = ShellRoutes.ManagementHome) {
        composable<ShellRoutes.ManagementHome> {
            ManagementHomeScreen(
                session = session,
                onOpenCustomerTags = { navController.navigate(ShellRoutes.CustomerTagList) },
                onOpenPackageDefinitions = { navController.navigate(ShellRoutes.PackageDefinitionList) },
                onOpenPackageReports = { navController.navigate(ShellRoutes.PackageReportsHome) },
                trailing = trailing,
            )
        }

        composable<ShellRoutes.PackageReportsHome> { entry ->
            PackageReportsHost(
                session = session,
                container = container,
                screen = PackageReportScreen.Home,
                owner = entry,
                onOpen = { navController.navigate(ShellRoutes.PackageReport(it.name)) },
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.PackageReport> { entry ->
            val route = entry.toRoute<ShellRoutes.PackageReport>()
            // Üç rapor girişin ViewModel'ini paylaşır: şube ve dönem raporlar arasında taşınsın.
            val owner = remember(entry) { navController.getBackStackEntry<ShellRoutes.PackageReportsHome>() }
            PackageReportsHost(
                session = session,
                container = container,
                screen = PackageReportScreen.valueOf(route.screen),
                owner = owner,
                onOpen = { navController.navigate(ShellRoutes.PackageReport(it.name)) },
                onBack = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.PackageDefinitionList> {
            PackageDefinitionListScreen(
                session = session,
                container = container,
                onBack = { navController.popBackStack() },
                onOpen = { id -> navController.navigate(ShellRoutes.PackageDefinitionEditor(id)) },
            )
        }

        composable<ShellRoutes.PackageDefinitionEditor> { entry ->
            val route = entry.toRoute<ShellRoutes.PackageDefinitionEditor>()
            PackageDefinitionEditorScreen(
                session = session,
                container = container,
                definitionId = route.definitionId,
                onBack = { navController.popBackStack() },
                // Liste dönüşte kendini sessizce tazeliyor; kaydı geri taşımaya gerek yok.
                onSaved = { navController.popBackStack() },
            )
        }

        composable<ShellRoutes.CustomerTagList> {
            CustomerTagListScreen(
                session = session,
                container = container,
                onBack = { navController.popBackStack() },
            )
        }
    }
}

/**
 * Yönetim kökü.
 *
 * Gerçek hub (katalog, personel, çalışma saatleri, kasa, prim) A7'de; bugün yalnız
 * A4.2'nin etiketleri ve A5'in paketleri gerçek. Kalanı için **sahte satır çizilmiyor** —
 * açılmayan bir menü, kullanıcıya var olmayan bir özellik vaat eder.
 */
@Composable
private fun ManagementHomeScreen(
    session: AppSession,
    onOpenCustomerTags: () -> Unit,
    onOpenPackageDefinitions: () -> Unit,
    onOpenPackageReports: () -> Unit,
    trailing: @Composable RowScope.() -> Unit,
) {
    KlinaraScreen(title = "Yönetim", trailing = trailing) {
        if (session.can(Permissions.CUSTOMER_READ)) {
            KlinaraCard(title = "Müşteriler") {
                KlinaraNavigationRow(
                    label = "Müşteri etiketleri",
                    value = "Kiracı genelinde tanımlı etiketler",
                    onClick = onOpenCustomerTags,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (session.can(Permissions.PACKAGE_READ)) {
            KlinaraCard(title = "Paketler") {
                KlinaraNavigationRow(
                    label = "Paket tanımları",
                    value = "Satılabilir seans paketleri ve fiyatları",
                    onClick = onOpenPackageDefinitions,
                    modifier = Modifier.fillMaxWidth(),
                )
                KlinaraNavigationRow(
                    label = "Paket raporları",
                    value = "Yükümlülük, süre dolumu ve dönem kullanımı",
                    onClick = onOpenPackageReports,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        KlinaraCard(title = "Yakında") {
            Text(
                text =
                    "Hizmetler, ekip ve çalışma saatleri Faz A7 ile; kasa ve prim Faz A6 ile geliyor.",
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
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
