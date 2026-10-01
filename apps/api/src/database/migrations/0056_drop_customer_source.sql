-- Müşteri geliş kaynağı (`customers.source`) kaldırıldı.
--
-- Alan pazarlama ölçümü içindi (bkz. 0052 — ürün pazarlama yapmıyor) ve
-- klinikler tarafından doldurulmuyordu; retention raporundaki "kazanım
-- kaynağı" kırılımı da onunla birlikte kaldırıldı. Kolonun check kısıtı
-- kolonla birlikte düşer.
alter table customers drop column source;
