-- Graph API varsayılan sürümü v21.0 → v26.0. Kayıtlı hesaplar kendi
-- sürümünü taşır; onlara dokunulmaz, yalnız yeni satırların varsayılanı değişir.
alter table whatsapp_accounts alter column api_version set default 'v26.0';
