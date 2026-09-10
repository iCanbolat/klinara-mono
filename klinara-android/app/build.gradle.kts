import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.compose.compiler)
}

/**
 * Makineye özel ayarlar `local.properties`'ten okunur (gitignore'lu),
 * yoksa -P bayrağı, o da yoksa varsayılan. CI ANDROID_SDK_ROOT export eder.
 */
fun localProp(
    key: String,
    default: String,
): String =
    providers.gradleProperty(key).orNull
        ?: rootProject
            .file("local.properties")
            .takeIf { it.exists() }
            ?.let { file ->
                Properties().apply { file.inputStream().use { load(it) } }.getProperty(key)
            }
        ?: default

android {
    namespace = "com.klinara.android"

    // Kurulu platform yalnız android-36.1; compileSdk = 36 tek başına android-36 indirmeye çalışır.
    compileSdk = 36
    compileSdkMinor = 1
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "com.klinara.android"
        // minSdk 26: FontVariation.Settings (Manrope variable font), adaptive icon, ucuz desugaring.
        // (StrongBox DEĞİL — o API 28+.)
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // AGP 9'da ikisi de varsayılan KAPALI.
    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        debug {
            // Debug ve release yan yana kurulabilsin diye. assetlinks.json iki giriş taşır (P3/P5).
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
            // Değer /api/v1'i ZATEN içerir (iOS Info.plist KlinaraAPIBaseURL paritesi),
            // böylece ApiRequest.path öneksiz kalır.
            buildConfigField(
                "String",
                "KLINARA_API_BASE_URL",
                "\"${localProp("klinara.apiBaseUrl", "http://10.0.2.2:3000/api/v1")}\"",
            )
            buildConfigField(
                "String",
                "KLINARA_WEBAUTHN_RP_ID",
                "\"${localProp("klinara.webauthnRpId", "")}\"",
            )
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField(
                "String",
                "KLINARA_API_BASE_URL",
                "\"${localProp("klinara.releaseApiBaseUrl", "https://api.klinara.app/api/v1")}\"",
            )
            buildConfigField(
                "String",
                "KLINARA_WEBAUTHN_RP_ID",
                "\"${localProp("klinara.releaseWebauthnRpId", "klinara.app")}\"",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    sourceSets {
        // Paylaşılan fixture'lar: repo kökündeki klinara-fixtures/ hem birim testlerin
        // classpath'ine hem debug APK'ye girer. `assets/` DEĞİL Java kaynağı, çünkü
        // assets bir AssetManager, o da bir Context ister; bu Context MockAuthService'e
        // ve oradan ServiceContainer.mock()'a sızar, sonra testler sırf bir JSON
        // string'i okumak için Robolectric ister.
        //
        // `release` kasten YOK: yayınlanan APK tek bayt fixture taşımaz.
        getByName("test") { resources.srcDir("../../klinara-fixtures") }
        getByName("debug") { resources.srcDir("../../klinara-fixtures") }
    }

    testOptions {
        unitTests.all { it.useJUnitPlatform() }
        // TokenStore tek bir `Log.w` çağırıyor (yalnız istisna SINIF ADI, asla
        // içerik). Onun için Robolectric getirmek orantısız; Base64 ise gerçek
        // java.util.Base64 olduğu için mühürle/aç gidiş-dönüşü hâlâ gerçekten test ediliyor.
        unitTests.isReturnDefaultValues = true
    }

    packaging {
        resources.excludes += setOf("META-INF/{AL2.0,LGPL2.1}", "META-INF/LICENSE*")
    }

    lint {
        warningsAsErrors = true
        abortOnError = true
        checkDependencies = true
        // Sıfırdan projede baseline OLUŞTURULMAZ — kimsenin okumadığı kalıcı borç defteridir.

        disable +=
            setOf(
                // --- "Daha yeni sürüm var" ailesi ---
                // Bunlar ağdan sürüm listesi çeker: derleme, biz hiçbir şey değiştirmesek de
                // yarın yeni bir kütüphane yayınlandığı için kırmızıya döner ve çevrimdışı
                // derlenemez. Sürüm yükseltmesi bilinçli bir iştir, rastgele bir derleme
                // hatası değil; libs.versions.toml elle ve batch notuyla güncellenir.
                "GradleDependency",
                "NewerVersionAvailable",
                "AndroidGradlePluginVersion",
                "OldTargetApi",
                // --- Bilinçli kararlar ---
                // Portre kilidi kasıtlı: iOS de portre-only ve bilgi mimarisi paritesi
                // isteniyor (§1 Kural 2). Chrome OS bu ürünün hedefi değil.
                "LockedOrientationActivity",
            )
    }
}

// Toolchain 21 (daemon da 21), bytecode hedefi 17 — kısıt D8 ve desugaring kütüphanesi.
kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    // Oturum diskten çözülürken sistem splash'i boşluğu örter (A1.1).
    implementation(libs.androidx.splashscreen)

    // Ağ ve serileştirme (A0.4). Retrofit YOK — bkz. BATCHES.md A0.4.
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    // Şifreli oturum deposu (A0.4). security-crypto deprecated; Keystore doğrudan.
    implementation(libs.androidx.datastore.preferences)

    // Kabuk içi gezinme (A2.1). Giriş akışı kullanmaz — o bir durum makinesi (§5.3).
    implementation(libs.androidx.navigation.compose)

    coreLibraryDesugaring(libs.desugar.jdk.libs)

    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.okhttp.mockwebserver3)
    testImplementation(libs.okhttp.mockwebserver3.junit5)
    testRuntimeOnly(libs.junit.platform.launcher)

    // Gerçek AndroidKeyStore yalnız cihazda test edilebilir (A0.4).
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
}

/**
 * iOS'ta font dosyası eksikse çalışma zamanında sisteme düşülür, çünkü `UIFont(name:)`
 * nil dönebilir. Android'de `R.font.x` derleme zamanında ya vardır ya proje derlenmez —
 * yani o fallback ölü koddur. Onun yerine dosyaların varlığını burada doğruluyoruz,
 * böylece "fontu silmişiz ama fark etmemişiz" hâli derlemeyi kırar.
 */
val verifyBrandFonts by tasks.registering {
    val fonts =
        listOf(
            "manrope_variable.ttf",
            "source_serif4_regular.ttf",
            "source_serif4_semibold.ttf",
        ).map { layout.projectDirectory.file("src/main/res/font/$it") }

    inputs.files(fonts)
    outputs.upToDateWhen { fonts.all { it.asFile.exists() } }

    doLast {
        val missing = fonts.filterNot { it.asFile.exists() }.map { it.asFile.name }
        if (missing.isNotEmpty()) {
            error("Marka fontu eksik: ${missing.joinToString()} — bkz. ANDROID_DEVELOPMENT.md §5.6 (P7)")
        }
    }
}

tasks.named("preBuild") { dependsOn(verifyBrandFonts) }
