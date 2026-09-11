package com.klinara.android.features.shell

import androidx.compose.runtime.remember
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.notifications.InboxScreen
import com.klinara.android.features.notifications.MessageDetailHost
import com.klinara.android.features.notifications.MessageLogHost
import com.klinara.android.services.ServiceContainer

/**
 * Yönetim sekmesinin İletişim hedefleri (A8).
 *
 * `ManagementTab`'ın içine yazılmadı: A8 on hedef getiriyor ve tek bir `NavHost` bloğunu
 * 400 satıra taşımak, kabuğun "hangi hedef nerede" sorusunu okunmaz kılardı. Grafik yine
 * TEK — bu yalnız bir `NavGraphBuilder` uzantısı, ikinci bir NavHost değil.
 */
internal fun NavGraphBuilder.communicationDestinations(
    navController: NavHostController,
    session: AppSession,
    container: ServiceContainer,
    openCustomer: ((String) -> Unit)?,
) {
    composable<ShellRoutes.Inbox> {
        InboxScreen(
            session = session,
            container = container,
            onBack = { navController.popBackStack() },
            onOpenCustomer = openCustomer,
        )
    }

    composable<ShellRoutes.MessageLog> { entry ->
        MessageLogHost(
            session = session,
            container = container,
            owner = entry,
            onOpen = { navController.navigate(ShellRoutes.MessageDetail(it)) },
            onBack = { navController.popBackStack() },
        )
    }

    composable<ShellRoutes.MessageDetail> { entry ->
        val route = entry.toRoute<ShellRoutes.MessageDetail>()
        val owner = remember(entry) { navController.getBackStackEntry<ShellRoutes.MessageLog>() }
        MessageDetailHost(
            session = session,
            container = container,
            owner = owner,
            messageId = route.messageId,
            onBack = { navController.popBackStack() },
        )
    }
}
