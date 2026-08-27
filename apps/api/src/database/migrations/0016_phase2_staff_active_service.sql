-- Faz 2.2'den kalan açık: PASİF bir hizmete personel yetkinliği atanabiliyordu.
--
-- Kural veritabanında durur, uygulamada değil: yetkinlik matrisi hem web hem
-- mobil istemciden ve ileride içe aktarma işlerinden yazılacak. Tek doğrulama
-- noktası, `services` tablosunu zaten okuyan mevcut kapsam trigger'ıdır.
--
-- KLINARA ÖZEL SQLSTATE ALANI ('K' sınıfı — PostgreSQL bu sınıfı kullanmaz):
--   K0001  geçersiz randevu durum geçişi   (Faz 3.1)
--   K0002  pasif hizmete yetkinlik atama
-- Ayrı kod, uygulamanın hatayı kiracı kapsamı ihlalinden (check_violation)
-- ayırt edip anlamlı bir mesaj döndürebilmesi içindir.

create or replace function staff_services_validate_scope() returns trigger
language plpgsql as $$
declare
  v_profile_tenant uuid;
  v_service_tenant uuid;
  v_service_active boolean;
  v_branch_tenant  uuid;
begin
  select tenant_id into v_profile_tenant from staff_profiles where id = new.staff_profile_id;
  select tenant_id, is_active into v_service_tenant, v_service_active
    from services where id = new.service_id;

  if v_profile_tenant is distinct from new.tenant_id then
    raise exception 'Personel profili başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  if v_service_tenant is distinct from new.tenant_id then
    raise exception 'Hizmet başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  if v_service_active is not true then
    raise exception 'Pasif hizmete yetkinlik atanamaz (service_id=%).', new.service_id
      using errcode = 'K0002';
  end if;

  if new.branch_id is not null then
    select tenant_id into v_branch_tenant from branches where id = new.branch_id;
    if v_branch_tenant is distinct from new.tenant_id then
      raise exception 'Şube başka bir kiracıya ait.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;
