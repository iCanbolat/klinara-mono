-- Davetle birlikte personel profili taslağı.
--
-- Uygulayıcı davet edilirken unvan, online görünürlük ve hizmet yetkinlikleri
-- davete yazılır; davet kabul edilince üyelikle AYNI transaction'da profil
-- açılır. Taslak şekli: { "title"?: string, "isVisibleOnline": boolean,
-- "serviceIds": uuid[] }. Hizmet kimlikleri kabulde yeniden doğrulanır (davet
-- ile kabul arasında hizmet pasife alınmış olabilir), bu yüzden foreign key
-- yerine jsonb tutuluyor.

alter table invitations
  add column staff_profile jsonb;

alter table invitations
  add constraint invitations_staff_profile_shape
  check (staff_profile is null or jsonb_typeof(staff_profile) = 'object');
