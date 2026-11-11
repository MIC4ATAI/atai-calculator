-- Klauzula informacyjna RODO przy CTA „Przyślij mi kalkulację”: treść i link do polityki prywatności pochodzą z organizacji
-- (administratorem danych leadów jest organizacja, nie operator platformy).
--
-- Kalkulator nie zbiera zgód marketingowych; klauzula jedynie informuje (art. 13 RODO), więc nie ma tu żadnego pola do
-- zaznaczenia. `cta_notice` pusty = domyślna treść z src/cta/notice.ts (z nazwą organizacji).

alter table public.organizations
  add column cta_notice text check (cta_notice is null or length(btrim(cta_notice)) between 20 and 1500);

-- Link do polityki prywatności trafia do przeglądarki klienta jako odnośnik: tylko https, bez białych znaków
-- (odrzuca m.in. javascript: i http:).
alter table public.organizations
  add constraint organizations_privacy_policy_url_check
  check (privacy_policy_url is null or (privacy_policy_url ~ '^https://[^[:space:]]+$' and length(privacy_policy_url) <= 500));

-- Edytują właściciel organizacji i operator (polityka organizations_update); konsultant nie.
grant update (cta_notice) on public.organizations to authenticated;
