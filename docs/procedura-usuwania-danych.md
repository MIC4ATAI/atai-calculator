# Procedura realizacji żądań dotyczących danych osobowych (usunięcie, dostęp, sprostowanie)

> **Status: PROJEKT do weryfikacji przez prawnika. Nie jest zaimplementowany.** Dokument opisuje, co aplikacja przechowuje,
> dlaczego zwykłe „usunięcie” rekordów jest w niej zablokowane z założenia, i proponuje procedurę oraz jej techniczną realizację.
> Podstawy prawne i terminy podano według mojej wiedzy o RODO i wymagają potwierdzenia. Rzeczy do Twojej decyzji są w sekcji 9.

## 1. Dlaczego potrzebna jest osobna procedura

Specyfikacja przewiduje, że **stan z rozmowy i historia zmian są niemodyfikowalne** (dowód tego, co ustalono z klientem), więc baza
je chroni na trzy sposoby: brak uprawnień do zmian, triggery blokujące `UPDATE`, `DELETE` i `TRUNCATE` także dla właściciela bazy, oraz
klucze obce `RESTRICT`. Sprawdziłem to na bazie produkcyjnej. Tabele tylko do dopisywania: `calc_events`, `calc_snapshots`, `leads`,
`lead_deliveries`, `usage_events`. Sesji z historią nie da się usunąć (klucze `RESTRICT` z sześciu tabel: `calc_events`, `calc_snapshots`, `leads`, `notification_outbox`, `session_visits`, `usage_events`). Zwykłe `DELETE` na żądanie osoby
**nie zadziała**. To zamierzone, ale oznacza, że musimy mieć udokumentowany, bezpieczny sposób realizacji art. 17 RODO.

## 2. Czyje dane i jakie żądania

| Kto | Skąd mamy jego dane | Typowe żądania |
| --- | --- | --- |
| **Rozmówca (klient)** | NIP, dane firmy z GUS, wartości z kalkulatora, e-mail z CTA, historia zmian i powrotów | usunięcie, dostęp, sprostowanie, sprzeciw |
| **Konsultant** | konto logowania, profil (imię i nazwisko, telefon, podpis), powiązanie z sesjami | odejście z organizacji (osobny proces, sekcja 7) |

Dla jednoosobowej działalności gospodarczej dane firmy (NIP, adres, liczby z kalkulatora) **są danymi osobowymi**. Dla spółki ich
dotyczy to tylko adresu e-mail i ewentualnie danych osób kontaktowych.

## 3. Role i terminy

- **Administratorem** danych leadów jest **organizacja** (dziś MITAX). Decyzję o żądaniu podejmuje ona. Operator platformy działa
  jako podmiot przetwarzający na jej polecenie (umowa powierzenia). Dla MITAX obie role pełni ta sama spółka, ale w dokumentach
  warto je rozdzielić, bo przy kolejnej organizacji (AT AI) tak będzie.
- **Termin:** odpowiedź bez zbędnej zwłoki, najpóźniej w ciągu **miesiąca** od otrzymania żądania; w razie skomplikowania lub liczby
  żądań można go przedłużyć o kolejne dwa miesiące, informując osobę w pierwszym miesiącu (art. 12 ust. 3 RODO).
- **Rejestr:** każde żądanie i sposób jego załatwienia zapisujemy (rozliczalność). Wzór wpisu w sekcji 8.

## 4. Mapa danych

| Dane | Gdzie | Osobowe? | Co z nimi robimy przy usunięciu |
| --- | --- | --- | --- |
| Adres e-mail | `leads.email` (tylko do dopisywania) | **tak** | **anonimizacja** na adres zastępczy `usuniety-<id>@erased.invalid` (zgodny z ograniczeniem formatu w bazie) |
| Dane firmy: nazwa, adres, REGON, NIP, surowa odpowiedź GUS | `companies` (blokowane po utworzeniu leada) | **tak dla JDG**; dla spółek nie | dla JDG: nazwa → „Dane usunięte”, adres i REGON → puste, `gus_raw` → puste, NIP → zastępczy numer z nieprawidłową sumą kontrolną (nie koliduje z prawdziwym NIP-em, zachowuje unikalność `(org_id, nip)`) |
| Liczby z kalkulatora (liczba klientów, pracowników, przychód, koszty) | `calc_sessions.inputs`, `calc_snapshots.inputs/result/mix` | **tak dla JDG** | wyczyszczenie do `{}` (snapshot jest tylko do dopisywania, więc przez procedurę wyjątkową, sekcja 6) |
| Odpowiedź rozmówcy (tekst wolny do 2000 znaków) | `calc_sessions.reply` oraz kopie w `calc_events` | **może zawierać dane osobowe** | wyczyszczenie w sesji i w zdarzeniach |
| Historia zmian | `calc_events.old_value/new_value` | **tak** (wartości pól i treść odpowiedzi) | wartości → `null`, zostają nazwa pola, aktor i czas (struktura dowodowa bez danych) |
| Dostawy maili | `lead_deliveries.error`, `provider_message_id` | pośrednio | błąd → puste, identyfikator wiadomości dostawcy → `null`; status i data zostają (rozliczenia) |
| Wizyty klienta | `session_visits` (czasy aktywności) | pośrednio | zostają (same czasy; po anonimizacji sesji i leada nie wskazują osoby; nie da się ich skasować, bo trzyma je klucz z `notification_outbox`) |
| Link do sesji | `calc_sessions.token` | pseudonim | sesja → `archived` (link przestaje działać) |
| Użycie do rozliczeń | `usage_events` | **nie** | zostaje (bez danych osobowych) |
| Alerty dla konsultantów | `notification_outbox` | nie (tylko identyfikatory) | zostaje |

**Zasada: anonimizacja zamiast fizycznego usunięcia.** Wiersze zostają (integralność kluczy, licznik wysyłek, rozliczenia), a pola
identyfikujące są nieodwracalnie zastępowane. Nieodwracalna anonimizacja jest powszechnie uznawana za sposób realizacji
usunięcia, o ile nie da się już zidentyfikować osoby. Do potwierdzenia przez prawnika (decyzja D2).

## 5. Poza naszą bazą (czego nie usuniemy sami)

| Miejsce | Co tam jest | Co robimy |
| --- | --- | --- |
| **Skrzynka odbiorcy** | mail z załącznikiem Excel (wynik, dane firmy) | **nie mamy nad nią kontroli**: informujemy osobę o tym w odpowiedzi |
| **MailerSend** | dziennik wysyłek z adresem odbiorcy (okres według planu) | usuwamy lub czekamy na wygaśnięcie zgodnie z ustawieniami planu; do sprawdzenia w panelu (D5) |
| **Kopie zapasowe Supabase** | pełna baza do czasu rotacji kopii | **dane odżyją po przywróceniu kopii**: dlatego rejestr (sekcja 8) pozwala ponownie zastosować usunięcie po każdym przywróceniu |
| **Logi dostawców** (Vercel, Supabase) | adres IP, nagłówki żądań | wygasają według polityki dostawców; informujemy w polityce prywatności |
| **n8n i Telegram** | brak danych klienta (alert niesie tylko zdarzenie i link) | nic do zrobienia |

## 6. Rozwiązanie techniczne (propozycja)

**Jedna funkcja wykonywana wyłącznie przez operatora w SQL** (nie z aplikacji i nie przez przeglądarkę):
`private.erase_person_data(p_lead_ids uuid[], p_session_ids uuid[], p_reason text)`. Zadania: anonimizuje dane z sekcji 4 dla wskazanych
leadów i sesji, zapisuje wpis w rejestrze, zwraca liczby zmienionych wierszy.

**Jak obejść blokady tylko dla tej funkcji, bezpiecznie.** Odrzucone rozwiązania: globalne wyłączenie triggerów (`alter table … disable
trigger`) oraz prosty przełącznik w sesji (`set_config`), bo każdy użytkownik bazy może ustawić własną zmienną sesyjną i obejść blokadę.
Proponuję **jednorazowy token w obrębie transakcji**: funkcja zapisuje losowy token do prywatnej tabeli i ustawia go w zmiennej
transakcyjnej, a triggery `forbid_mutation` przepuszczają zmianę tylko wtedy, gdy zmienna zgadza się z tokenem z tej tabeli (tabela
niedostępna dla klientów; token znika z końcem transakcji). Bez znajomości tokenu blokada działa jak dotąd.

**Kolejność operacji ma znaczenie.** Aktualizacja `calc_sessions.inputs` uruchamia trigger dziennika zmian, który **kopiuje stare wartości do
nowych wierszy** `calc_events`. Gdybyśmy czyścili sesję przed zdarzeniami, dane osobowe powstałyby na nowo. Dlatego: (1) zablokować zapis
dziennika na czas transakcji (ten sam token), (2) wyczyścić `calc_events`, (3) snapshoty, (4) sesję, (5) dostawy i leady, (6) firmę.

**Rejestr `erasure_requests`** (tylko do dopisywania, bez danych osobowych): identyfikator wpisu, organizacja, data żądania i wykonania,
rodzaj żądania, identyfikatory sesji i leadów (UUID, nie e-maile), liczby wierszy, wykonawca, podstawa decyzji. Po przywróceniu kopii
zapasowej funkcję wykonuje się ponownie dla zapisanych identyfikatorów.

**Testy (pgTAP), obowiązkowe jak przy reszcie bazy:** klient nie może wywołać funkcji ani zmienić tabel; po wykonaniu żaden wiersz nie
zawiera e-maila, nazwy ani liczb osoby; **dane innych sesji i organizacji zostają nietknięte**; funkcja jest idempotentna; brak kopii
danych w nowych zdarzeniach; rejestr zawiera wpis; blokady `UPDATE/DELETE` działają jak dotąd poza funkcją.

## 7. Konsultant odchodzący z organizacji

Konta konsultantów nie da się usunąć (`calc_sessions.consultant_id` jest `RESTRICT`). Procedura: wyłączyć konto (zablokować logowanie w
Supabase Auth), usunąć członkostwo w organizacji, zanonimizować profil (imię i nazwisko → „Były konsultant”, telefon, podpis i zdjęcie
→ puste). Sesje i leady zostają przypisane do zanonimizowanego konta. Podstawa przechowywania to interes organizacji w dokumentacji
rozmów (do potwierdzenia, D6).

## 8. Przebieg krok po kroku

1. **Przyjęcie.** Żądanie na adres z polityki prywatności. Rejestrujemy datę wpływu, treść i nadawcę. Odliczamy miesiąc.
2. **Weryfikacja tożsamości** (proporcjonalna): odpowiedź na adres e-mail z leada, ewentualnie potwierdzenie NIP-u. Nie żądamy
   dokumentów tożsamości bez potrzeby.
3. **Ustalenie zakresu.** Zapytania pomocnicze poniżej (tylko odczyt). Zapisujemy znalezione identyfikatory.
4. **Ocena wyjątków** (art. 17 ust. 3 RODO): czy są dane potrzebne do ustalenia, dochodzenia lub obrony roszczeń albo wynikające z
   obowiązku prawnego (np. umowa już zawarta, trwający spór). Decyzję zapisujemy.
5. **Decyzja** administratora: usunąć całość, usunąć część, odmówić z uzasadnieniem.
6. **Wykonanie** funkcji z sekcji 6 przez operatora, na wskazanych identyfikatorach. Weryfikacja zapytaniami kontrolnymi (brak e-maila).
7. **Odpowiedź do osoby** w terminie: co usunięto, czego nie (i dlaczego), że kopia maila w jej skrzynce nie podlega naszej kontroli,
   że dane w kopiach zapasowych znikną po ich rotacji, pouczenie o prawie skargi do Prezesa UODO.
8. **Wpis w rejestrze** (sekcja 6) i zamknięcie sprawy.

**Zapytania pomocnicze (tylko odczyt; poprawność składni sprawdzona na bazie produkcyjnej):**

```sql
-- po adresie e-mail
select l.id as lead_id, l.session_id, l.created_at, c.nip, s.status, s.org_id
from public.leads l join public.calc_sessions s on s.id = l.session_id join public.companies c on c.id = l.company_id
where l.email = lower(btrim('<adres e-mail>')) order by l.created_at;

-- po NIP-ie (jednoosobowa działalność)
select s.id as session_id, s.org_id, s.status, c.nip, c.name, s.created_at
from public.companies c join public.calc_sessions s on s.company_id = c.id
where c.nip = '<NIP>' order by s.created_at;

-- zakres rekordów jednej sesji
select s.id,
  (select count(*) from public.calc_events e where e.session_id = s.id) as zdarzenia,
  (select count(*) from public.calc_snapshots x where x.session_id = s.id) as snapshoty,
  (select count(*) from public.leads l where l.session_id = s.id) as leady,
  (select count(*) from public.lead_deliveries d join public.leads l on l.id = d.lead_id where l.session_id = s.id) as dostawy,
  (select count(*) from public.session_visits v where v.session_id = s.id) as wizyty
from public.calc_sessions s where s.id = '<uuid sesji>';
```

## 9. Decyzje, które trzeba podjąć

| # | Pytanie | Moja propozycja |
| --- | --- | --- |
| **D1** | **Okres przechowywania** danych z rozmów i leadów bez żądania usunięcia (potrzebny też do polityki prywatności) | do ustalenia z prawnikiem; np. 12 do 24 miesięcy od ostatniego kontaktu, po czym automatyczna anonimizacja (osobne zadanie, jeszcze nieopracowane) |
| **D2** | Czy **nieodwracalna anonimizacja** wystarcza jako „usunięcie” | tak, jeśli prawnik potwierdzi; fizyczne usunięcie wymagałoby wyłączenia ochrony i zniszczyłoby integralność rozliczeń |
| **D3** | Jak traktować **NIP jednoosobowej działalności** | anonimizować (jest danymi osobowymi), zastępczy numer o nieprawidłowej sumie kontrolnej |
| **D4** | **Kto wykonuje**: operator na polecenie administratora czy administrator sam | operator (osoba z dostępem do bazy produkcyjnej), na piśmie od administratora |
| **D5** | Okres przechowywania **logów dostawców** (MailerSend, Vercel, Supabase) i kopii zapasowych | sprawdzić w panelach i wpisać do polityki prywatności |
| **D6** | Podstawa przechowywania danych **konsultantów** po odejściu | interes administratora w dokumentacji rozmów; do potwierdzenia |
| **D7** | **Kiedy wdrożyć** funkcję | przed pierwszym prawdziwym klientem (żądanie może przyjść w dowolnym momencie, a termin to miesiąc) |

## 10. Propozycje brzmienia do polityki prywatności (sekcja 8 dokumentu w aplikacji)

Do wstawienia w `src/legal/policy.ts` dopiero po decyzjach D1, D2 i zatwierdzeniu przez prawnika:

- **`retention`:** „Dane z rozmów i kalkulacji przechowujemy przez [okres z D1] od ostatniego kontaktu, a następnie nieodwracalnie anonimizujemy.”
- **`erasureHandling`:** „Żądanie usunięcia danych rozpatrujemy w ciągu miesiąca. Ze względu na sposób zapisu historii rozmów dane identyfikujące
  (adres e-mail, nazwę i adres firmy jednoosobowej, wpisane wartości) nieodwracalnie anonimizujemy zamiast je fizycznie usuwać. Dane niezbędne
  do ustalenia, dochodzenia lub obrony roszczeń możemy zachować na podstawie art. 17 ust. 3 lit. e RODO. Nie mamy wpływu na kopię wiadomości
  w Twojej skrzynce pocztowej, a dane w kopiach zapasowych znikają po ich rotacji.”

## 11. Plan wdrożenia

1. Decyzje D1 do D7 (Ty + prawnik).
2. Migracja z funkcją, rejestrem i zmianą triggerów oraz testami pgTAP (około jednego kroku implementacyjnego, jak dotychczasowe etapy).
3. Próba na lokalnej bazie z danymi testowymi, w tym scenariusz „przywrócenie kopii i ponowne zastosowanie”.
4. Wdrożenie przez `db push` (jak pozostałe migracje), uzupełnienie polityki prywatności i `legalReviewedAt`.
5. Opis ręcznego postępowania dla operatora (ten dokument, sekcja 8) i szablon odpowiedzi do osoby.
