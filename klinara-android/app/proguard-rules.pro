# R8 tam mod kuralları. Faz A10'da genişletilir (kotlinx.serialization, OkHttp).

# Release'te log tamamen kapalı — sağlık verisi/token logcat'e düşmemeli (§7.9).
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
}
