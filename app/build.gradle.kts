plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "dev.pipocket"
    compileSdk = 35
    // Opt-in fixture APK: a separate Android sandbox, never the user's pairing/history.
    defaultConfig { applicationId = if (providers.gradleProperty("reliabilityTests").orNull == "true") "dev.pipocket.reliability" else "dev.pipocket"; minSdk = 26; targetSdk = 35; versionCode = 7; versionName = "0.6.1"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.drawerlayout:drawerlayout:1.2.0")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
