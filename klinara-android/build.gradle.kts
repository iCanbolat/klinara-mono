import io.gitlab.arturbosch.detekt.extensions.DetektExtension

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.compose.compiler) apply false
    alias(libs.plugins.ktlint)
    alias(libs.plugins.detekt)
}

subprojects {
    apply(plugin = "org.jlleitschuh.gradle.ktlint")
    apply(plugin = "io.gitlab.arturbosch.detekt")

    extensions.configure<DetektExtension> {
        buildUponDefaultConfig = true
        config.setFrom(rootProject.file("config/detekt/detekt.yml"))
        parallel = true
    }

    // ktlint ve detekt eklentileri `check`e kendileri bağlanır; bu blok yalnız
    // sözleşmeyi açık kılar. `base` uygulanmadan `check` görevi var olmadığı için
    // withId geri çağrısı içinde bağlanır (subprojects{} :app'ten önce koşar).
    plugins.withId("base") {
        tasks.named("check") {
            dependsOn("ktlintCheck", "detekt")
        }
    }
}
