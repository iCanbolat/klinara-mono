pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    // Toolchain'i (JDK 21) makinede yoksa indirebilmek için. Bkz. gradle/gradle-daemon-jvm.properties
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "klinara-android"

// Tek modülle başlanır. Temiz derleme > 90 sn olduğunda :core:* ayrılır
// (ANDROID_DEVELOPMENT.md §4 — bu bir karar değil, bir tetikleyici).
include(":app")
