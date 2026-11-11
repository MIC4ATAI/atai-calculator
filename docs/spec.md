# Kalkulator BR – specyfikacja: NIP, zgody i sesje

Stan na 2026-11-11. Wersja robocza dokumentu (edytowalna, z komentarzami):
https://claude.ai/artifact/V3Ko5Z87pw5LNKTvQLazoi — przy rozbieżnościach źródłem prawdy jest
dokument roboczy; ten plik aktualizujemy razem z nim.

## Cel i przebieg

Kalkulator ma nie tylko pokazać wynik w rozmowie, ale też zebrać leada i zostawić ślad tego,
co klient robi po rozmowie. Przebieg:

1. Rozmówca podaje NIP na początku rozmowy. System go waliduje i pobiera dane firmy z GUS.
2. Rozmówca wpisuje dane do kalkulacji, w tym trzy pola finansowe (lub prezenter mu je podpowiada).
3. Prezenter odsłania wynik, rozmówca bawi się suwakiem miksu klientów.
4. CTA: „Przyślij mi kalkulację jako Excel oraz link do sesji kalkulatora” — rozmówca podaje tylko
   e-mail, bez zgód.
5. System zamraża stan z rozmowy, wysyła Excel i link. Mail zawiera zaproszenie na landing page
   do pozostawienia kontaktu i zgód.
6. Rozmówca może wracać do sesji i symulować; prezenter widzi każdy powrót i każdą zmianę.

Prototyp przebiegu: https://claude.ai/artifact/3vuquvjRr9PT5MVD5W5dbD

## Logika obliczeń

Źródło prawdy: arkusz „kalkulator-br”; implementacja: `src/calc/calculator.ts`.

- Dane rozmówcy: liczba klientów KH i KPiR/ryczałt, liczba pracowników, roczny przychód,
  roczne wynagrodzenia z narzutami; opcjonalnie (z wartościami domyślnymi): efektywność 80%,
  współczynnik czasu KH/KPiR = 2, współczynnik ceny KH/KPiR = 4.
- Ciche założenia: cel korzyści 10 000 zł/mies., 21 dni roboczych, 8 h dziennie.
- Wynik pokazywany jako odzyskany czas, wyceniony kosztem zatrudnienia, przeliczony na nowych
  klientów, których biuro obsłuży bez dodatkowych etatów. Suwak miksu: od „tylko KH” do „tylko KPiR”.
- Przykład kontrolny: 100 KH, 200 KPiR, 9 osób, 2 mln zł przychodu, 1,2 mln zł wynagrodzeń →
  121 h/mies., 36 min/mies. na kliencie KH (1 min 44 s dziennie), +20 KH albo +40 KPiR,
  20 KH ≈ 22 222 zł przychodu/mies.
- Przychód na efektywną godzinę (zł/h) = roczny przychód / 12 / efektywne roboczogodziny
  w miesiącu (arkusz: `=C4/C14`); w przykładzie kontrolnym 137,79 zł/h. Bez przychodu: brak wartości.
  Pokazywany w widoku prezentera; rozmówca go nie widzi.
- Wersja logiki `CALC_VERSION`: **1.1.0** (dodano przychód na efektywną godzinę; wcześniejsze wzory
  bez zmian). Każda zmiana wzorów podbija wersję, bo zamrożone stany zapisują wersję, którą policzono wynik.

## SaaS: organizacje, konsultanci, operator

Kalkulator jest osobną aplikacją SaaS dla wielu organizacji; pierwsze dwie to
MITAX Consulting sp. z o.o. i AT AI Solutions.

| Rola | Kto | Co widzi i robi |
| --- | --- | --- |
| Operator platformy | dostawca SaaS (dziś Marek, w przyszłości ewentualny nabywca) | zakłada organizacje, rozlicza użycie; nie ma wglądu w leady organizacji |
| Organizacja (tenant) | płacący podmiot, np. MITAX, AT AI | własna marka, własne leady, własna polityka prywatności; jest administratorem danych swoich leadów |
| Właściciel / admin organizacji | np. wspólnik w AT AI | dodaje konsultantów, widzi wszystkie sesje organizacji |
| Konsultant | osoba prowadząca rozmowy, np. Marek Kustosz w MITAX | prowadzi sesje, widzi swoje leady |

- **Marka:** rozmówca widzi markę organizacji (logo, kolory, nadawca maili, polityka prywatności)
  i osobę konsultanta (imię i nazwisko, zdjęcie, telefon, podpis).
- **Jedno konto, kilka organizacji:** konsultant może należeć do więcej niż jednej organizacji
  i wybiera ją przy otwieraniu sesji.
- **Separacja:** osobne repozytorium (organizacja GitHub MIC4ATAI), osobne konta Supabase, Vercel
  i MailerSend, zero zależności od mitax-main. Start pod atai.mitax.pl, docelowo własna domena.
- **RODO:** operator jest podmiotem przetwarzającym; z każdą organizacją zawiera umowę
  powierzenia przetwarzania.
- **Rozliczenia:** użycie (sesje, wysłane kalkulacje) zliczane od pierwszego dnia; na start
  miesięczny raport i faktura ręczna.
- **Do decyzji:** model cenowy (za konsultanta, za wysłaną kalkulację czy udział w umowach);
  czy założenia kalkulatora (cel korzyści, dni, godziny) ustawia organizacja.

### MITAX jako operator i tenant jednocześnie

- **W aplikacji:** rola operatora to uprawnienie przypisane do konkretnych kont, a nie cecha
  organizacji. MITAX w systemie jest zwykłym tenantem. Panel operatora nie ma dostępu do leadów
  żadnej organizacji.
- **Brak dostępu operatora do leadów wymuszony technicznie** (RLS). Ewentualny wgląd w dane
  organizacji tylko za jej zgodą i z wpisem w dzienniku dostępu.
- **Prawnie:** jako tenant MITAX jest administratorem danych swoich leadów; jako operator —
  podmiotem przetwarzającym dane leadów AT AI na podstawie umowy powierzenia.
- **Zaufanie wspólnika:** umowa SaaS zawiera klauzulę poufności; operator technicznie nie widzi
  leadów organizacji.
- **Przy sprzedaży:** rolę operatora przejmuje nabywca, a MITAX zostaje klientem na takich samych
  warunkach jak AT AI. Użycie przez MITAX jest zliczane jak u każdego tenanta.

## NIP: walidacja i dane z GUS

- **Walidacja sumy kontrolnej przy wpisywaniu** (`src/calc/nip.ts`): wagi 6, 5, 7, 2, 3, 4, 5, 6, 7
  dla pierwszych 9 cyfr; suma modulo 11 musi dać 10. cyfrę; wynik 10 oznacza błędny NIP.
- **Dane z GUS (usługa BIR1)** przez Supabase Edge Function — klucz API nie może trafić do
  przeglądarki. Klucz produkcyjny: wniosek na regon_bir@stat.gov.pl. Bez klucza dostępna jest
  tylko baza testowa ze starymi, zanonimizowanymi danymi. Biblioteka dla Node: `bir1`.
- **Bez automatycznego pobierania danych finansowych z KRS.** Przychód i wynagrodzenia wpisuje
  rozmówca (lub podpowiada prezenter); dla JDG rozmówca podaje szacunki.

## E-mail i zgody

Kalkulator nie zbiera żadnych zgód: wysyła tylko to, o co klient jednorazowo poprosił.
Zgody zbiera osobny landing page organizacji, do którego prowadzi zaproszenie w mailu.

| Gdzie | Co się dzieje | Podstawa |
| --- | --- | --- |
| Kalkulator, CTA | klient podaje e-mail i dostaje Excel z wynikami oraz link do sesji | realizacja jego jednorazowego żądania |
| Mail z kalkulacją | w marce organizacji, podpisany przez konsultanta; krótkie zaproszenie do pozostawienia kontaktu + link | brak zgody potrzebnej, to tylko link |
| Landing page organizacji | dane kontaktowe, osobne niezaznaczone zgody, polityka prywatności i administrator danych tej organizacji, prawa osób | dobrowolne zgody na rzecz organizacji |

- Zaproszenie w mailu to krótki dopisek, nie treść reklamowa. Brzmienie do potwierdzenia
  z prawnikiem.
- Landing page zapisuje przy każdej zgodzie treść klauzuli z numerem wersji, datę i godzinę
  oraz adres IP.
- Link na landing page może nieść identyfikator sesji, żeby powiązać zgody z firmą i kalkulacją.

## Zamrożenie stanu sesji przy CTA

1. **Powstaje snapshot:** dane wejściowe, założenia, wyniki, miks z suwaka i wersja logiki
   obliczeń (`CALC_VERSION`). RLS pozwala go tylko utworzyć, nigdy zmienić.
2. **NIP, e-mail i dane z GUS zostają zablokowane** w osobnej tabeli, do której link klienta
   nie daje prawa zapisu. Klient zmienia tylko parametry symulacji.
3. **Excel powstaje ze snapshotu** i ma dwie zakładki: „Kalkulacja z rozmowy (data)” z samymi
   wartościami oraz „Twoja symulacja” z działającymi formułami.

## Powrót klienta do sesji

- **U klienta:** stały pasek „Wynik z rozmowy: 121 h → +20 klientów KH”, pod nim bieżąca
  symulacja z różnicą względem rozmowy. Przycisk „Wróć do stanu z rozmowy”.
- **Dziennik zdarzeń:** każda zmiana zapisuje kto, które pole, z jakiej wartości na jaką i kiedy.
- **Powiadomienie dla konsultanta** przez n8n (np. Telegram).
- **Widok przed follow-upem:** stan z rozmowy, ostatnia symulacja i lista zmian obok siebie.

## Sesja na żywo (etap 1)

- **Link rozmówcy:** `/s/<token>`, token to 24 losowe bajty (48 znaków hex), generowany w bazie.
  Otwiera się bez logowania. Rozmówca nie ma dostępu do żadnej tabeli — cały jego dostęp idzie
  przez Edge Function `guest-session` (service role po stronie serwera, `verify_jwt = false`).
- **Co widzi rozmówca:** swoje dane, miks z suwaka, własną odpowiedź i — dopiero po odsłonięciu
  przez konsultanta — wynik. Ciche założenia (`params`) nie są przekazywane wprost; wynik zawiera
  tylko to, co trzeba pokazać (godziny, minuty, miks, ewentualnie wartość czasu), bez kosztu
  zatrudnienia, efektywnych godzin i kosztu godziny. Zapis ogranicza lista dozwolonych pól
  (`kh`, `kpir`, `prac`, `przychod`, `koszty`, `ef`, `wspCzas`, `wspCena`), miks i odpowiedź
  (do 2000 znaków).
- **Obliczenia** robi wyłącznie `src/calc` — ta sama implementacja w aplikacji i w Edge Function
  (funkcja importuje moduł bezpośrednio, bez kopii).
- **Realtime:** konsultant dostaje zmiany wiersza `calc_sessions` przez `postgres_changes` (przechodzą
  przez RLS). Rozmówca słucha pustego pinga Broadcast na kanale `session:<token>` (wysyła go trigger
  bazy) i po nim pobiera stan przez funkcję. Przez publiczny kanał nie płyną żadne dane.
- **Zapisy:** sesje powstają wyłącznie przez RPC `create_calc_session` (sprawdza członkostwo).
  Dane rozmówcy zmienia się przez RPC `patch_calc_session_inputs` (konsultant) i
  `guest_patch_calc_session` (tylko service role) — scalają pola po stronie bazy, więc równoległe
  wpisy konsultanta i rozmówcy się nie nadpisują.
- **Dziennik zmian** wpisuje trigger bazy, nie aplikacja: aktor to `guest` (bez zalogowanego
  użytkownika) albo `consultant`, więc nie da się go podrobić.

## Model danych

| Tabela | Zawartość | Kto może zmieniać |
| --- | --- | --- |
| `organizations` | tenant: nazwa, NIP, marka (logo, kolory, nadawca maili), link do polityki prywatności, domyślne założenia kalkulatora | operator; marka i założenia także właściciel organizacji (nazwę i NIP zmienia tylko operator) |
| `profiles` | osoba: imię i nazwisko, zdjęcie, telefon, podpis; tworzony automatycznie przy założeniu konta | sama osoba |
| `memberships` | osoba w organizacji i jej rola (właściciel / admin / konsultant) | operator, właściciel organizacji |
| `platform_operators` | konta z rolą operatora platformy (uprawnienie konta, nie cecha organizacji) | migracje / service role; klient nie ma zapisu |
| `companies` | firmy rozmówców: NIP, REGON, nazwa, adres, surowa odpowiedź GUS | serwer |
| `leads` | `org_id`, konsultant, firma, e-mail podany do wysłania kalkulacji | serwer, tylko dopisywanie |
| `consents` | zgody z landing page organizacji: treść i wersja klauzuli, czas, IP, powiązanie z leadem | serwer, tylko dopisywanie |
| `calc_sessions` | `org_id`, konsultant, token linku, status (na żywo / udostępniona / zarchiwizowana), dane rozmówcy (`inputs`), ciche założenia sesji (`params`, kopia z organizacji w chwili utworzenia), `revealed`, `mix_kh`, `reply` | serwer (RPC i Edge Function); konsultant zmienia założenia, odsłonięcie, miks i status własnej sesji |
| `calc_snapshots` | zamrożone dane wejściowe, wyniki, miks, wersja logiki | tylko tworzenie |
| `calc_events` | dziennik zmian (rozmówca / konsultant) | tylko dopisywanie (wpisuje trigger bazy) |
| `usage_events` | zliczanie użycia na potrzeby rozliczeń (`session_created`) | serwer, tylko dopisywanie |

RLS: konsultant widzi swoje sesje i leady, właściciel i admin — całą organizację, organizacje
nie widzą się nawzajem. Operator widzi organizacje, członkostwa (zarządza nimi) i użycie; nie widzi
sesji, dziennika zdarzeń ani snapshotów. Testy tych reguł (pgTAP, `supabase/tests/`) są częścią
etapu 1; każda polityka ma test.

Tylko-dopisywanie jest egzekwowane na trzy sposoby: brak grantów UPDATE/DELETE dla klienta, brak
polityk i trigger blokujący UPDATE, DELETE i TRUNCATE także dla service role i właściciela bazy.
Tabele `calc_snapshots`, `calc_events` i `usage_events` odwołują się do sesji kluczem obcym
`RESTRICT`, więc **sesji z historią nie da się usunąć**. Usuwanie danych na żądanie osoby (RODO)
wymaga osobnej, świadomej migracji.

## Kolejność pytań w rozmowie

Decyzja: NIP na początku rozmowy, e-mail dopiero przy CTA, zgody wyłącznie na landing page.

## Etapy budowy

| Etap | Co powstaje |
| --- | --- |
| 1. MVP | model wieloklientowy z RLS i testami, moduł obliczeń, widok rozmówcy i konsultanta, sesja na żywo (Supabase Realtime), zliczanie użycia |
| 2. Lead | NIP z walidacją i GUS, CTA z e-mailem, zamrożenie stanu, Excel, wysyłka maila w marce organizacji |
| 3. Follow-up | dziennik zmian, powiadomienia przez n8n, widok „rozmowa vs ostatnia symulacja” |
| 4. Reszta | landing page'e organizacji ze zgodami, panel operatora z rozliczeniem użycia, migracja kontaktów z LinkedIn |

### Stan etapu 1 (2026-11-11)

Zrobione: szkielet Vite + React + TypeScript; migracja bazy (osiem tabel: `organizations`,
`profiles`, `memberships`, `platform_operators`, `calc_sessions`, `calc_snapshots`, `calc_events`,
`usage_events`) z RLS i testami pgTAP; logowanie konsultanta magic linkiem i wybór organizacji;
tworzenie sesji, lista sesji i link dla rozmówcy; sesja na żywo (widok rozmówcy i prezentera,
Realtime, odsłanianie wyniku, suwak miksu po obu stronach); zliczanie użycia.

Odstępstwa od prototypu i pierwotnego planu:

- **„Dodatkowi klienci KH”** w widoku prezentera to liczba całkowita (`maksNowychKh`, etykieta
  „Maks. nowi klienci KH”), a nie wartość ułamkowa.
- **Komunikat dla rozmówcy** „Uzupełnij dane powyżej, a wynik pojawi się tutaj.” — gdy wynik jest
  odsłonięty, ale dane są niekompletne (w prototypie nic się wtedy nie pokazywało).
- **Ciche założenia** nie są sekretem kryptograficznym: nie przekazujemy ich wprost, ale rozmówca
  widzi godziny do odzyskania, z których da się wyliczyć iloczyn `cel / (dni × godziny)`. Prototyp
  też pokazuje rozmówcy cel jako „wartość czasu”, gdy nie podał przychodu.
- **Lista „Sesje”** pokazuje tylko własne sesje konsultanta; widok całej organizacji dla właściciela
  i admina (RLS na to pozwala) jest poza zakresem etapu 1.

Nie zbudowane w etapie 1 (zgodnie z zakresem): NIP i GUS, e-mail i Excel, zamrażanie stanu przy CTA,
powiadomienia, landing page'e organizacji, panel operatora.

### Stan etapu 2 (zrobiony) — wyniki spików (2026-11-11)

Trzy ryzyka techniczne sprawdzone lokalnie w Edge Runtime (kod spiku wyrzucony):

- **GUS (BIR1):** `npm:bir1@4.2.0` działa w Deno, a kontener Edge Runtime sięga publicznej bazy
  testowej (odpowiedź w ok. 0,5 s; dane anonimizowane, np. „ul. Test-Krucza”; biblioteka ma wbudowany
  publiczny klucz testowy). NIP spoza rejestru to `BirError` z `response.ErrorCode === "4"` — tak
  odróżniamy „nie znaleziono” od awarii usługi, bez dopasowywania tekstu komunikatu. Działające NIP-y
  testowe: `5261040567`, `5260250995`, `7740001454`, `5252248481`.
- **Excel:** `npm:exceljs@4.4.0` działa w Deno: zapisuje formuły z wartościami buforowanymi (`<f>` obok
  `<v>`), nazwy zakładek do 31 znaków, szerokości kolumn i formaty liczb.
- **Poczta lokalnie:** kontener funkcji wysyła mail z załącznikiem przez API Mailpita pod adresem
  `http://supabase_inbucket_<project_id>:8025/api/v1/send` (ta sama sieć Dockera); polskie znaki i
  załącznik docierają bez zniekształceń, a załącznik da się odczytać z
  `/api/v1/message/<id>/part/<partID>`. Adres Mailpita jest konfigurowalny (zmienna środowiskowa).

Generator Excela (`src/excel/`, krok 2.4):

- **Jeden kod w Node i w Deno.** `src/excel/workbook.ts` importuje `exceljs` gołym specyfikatorem; funkcja
  Edge Runtime mapuje go w własnym `deno.json` (`{"imports": {"exceljs": "npm:exceljs@4.4.0"}}`). Plik zbudowany
  w Deno jest identyczny z plikiem zbudowanym w Node (porównanie komórka po komórce: 243 komórki, 0 różnic, wraz
  ze strefą czasową Europe/Warsaw w nazwie zakładki).
- **Parytet z `src/calc`.** Formuły zakładki „Twoja symulacja” (`src/excel/layout.ts`) to druga implementacja
  wzorów w języku Excela. Test (`parity.test.ts`) liczy je silnikiem HyperFormula i porównuje z `calculate()`
  i `mix()` dla ośmiu zestawów danych (w tym granica `floorSafe`, bez przychodu, współczynnik 1), także po
  „ręcznej” zmianie pól, oraz zawiera kontrole negatywne. Zmiana wzorów w `src/calc` bez zmiany Excela wywala test.
- **Licencja HyperFormula to GPL-3.0** — używana wyłącznie jako zależność deweloperska do testów; nie trafia do
  aplikacji ani do Edge Functions. Do decyzji właściciela, czy to akceptowalne dla kodu zastrzeżonego.
- **Jawne ciche założenia.** Żeby formuły działały, cel korzyści, dni robocze i godziny są w Excelu zwykłymi,
  widocznymi komórkami — rozmówca zobaczy je po CTA.

Mail z kalkulacją, polityka CTA i adaptery poczty (`src/email/`, `src/cta/`, krok 2.5):

- **Mail** (HTML + tekst, po polsku): pozdrowienie, opis załącznika, jedna linia wyniku („121 h miesięcznie →
  +20 klientów KH”), link do sesji, podpis konsultanta z profilu, stopka. Marka z `organizations.brand`
  (`logoUrl` i `landingUrl` tylko https, `primaryColor`, `senderName`, `senderEmail`) — każde pole jest
  walidowane osobno, niepoprawne jest odrzucane. Wszystkie dane dynamiczne (m.in. nazwa firmy z GUS) są
  escapowane, a temat sprowadzany do jednej linii. Kolor tekstu na przycisku dobierany wg kontrastu (WCAG).
- **Do potwierdzenia z prawnikiem** (stałe w `src/email/template.ts`): `LANDING_INVITATION_TEXT` (zaproszenie na
  landing page) i `ONE_TIME_NOTICE_TEXT` (stopka). Link do landing page nie niesie identyfikatora sesji —
  sposób powiązania zgód z firmą i kalkulacją ustali etap 4.
- **MailerSend zwraca 202 także wtedy, gdy wszyscy odbiorcy są zablokowani (suppressed)** — wtedy nie ma
  nagłówka `x-message-id` i mail NIE został wysłany. Taka odpowiedź (jak i `x-send-paused`) nie jest liczona jako
  udana dostawa. Śledzenie otwarć i kliknięć jest wyłączone (`settings`), bo to jednorazowa wiadomość na prośbę.
- **Polityka CTA** (`decideCta`): wysyłka dozwolona po odsłonięciu wyniku, przy podanym NIP-ie i kompletnych danych,
  do 3 udanych wysyłek na sesję; po pierwszej udanej adres jest zablokowany. SQL (`prepare_calculation_delivery`)
  pozostaje ostatecznym strażnikiem — TS daje tanie odrzucenia i komunikaty przed budowaniem Excela.
- **Adaptery** (`createMailer`): `MAIL_TRANSPORT=mailersend` (domyślny) albo `mailpit` (tylko lokalnie); odczyt
  środowiska i `fetch` są wstrzykiwane, więc logika jest testowana bez Deno. Błędy zapisywane w
  `lead_deliveries.error` mają najwyżej 200 znaków, jedną linię i nie zawierają tokenu ani adresu odbiorcy.

CTA end-to-end (`request-calculation`, krok 2.6):

- **Przebieg:** polityka CTA → RPC `prepare_calculation_delivery` (snapshot i lead, atomowo) → Excel i mail
  zbudowane ZE SNAPSHOTU → wysyłka → zapis dostawy. Ponowna wysyłka po zmianach rozmówcy przesyła nadal stan z
  rozmowy (sprawdzone: po zmianie `kh` 100 → 999 plik ma nadal 100). Konfiguracja poczty jest sprawdzana przed
  zamrożeniem, więc błąd konfiguracji nie zostawia snapshotu ani leada.
- **Blokady:** lead (także po nieudanej próbie) blokuje zmianę NIP-u; adres e-mail blokuje się dopiero po pierwszej
  UDANEJ wysyłce, więc literówka lub awaria poczty nie zamykają rozmówcy w pułapce. Limit 3 udanych wysyłek jest
  egzekwowany i w TS (`MAX_SENDS`), i w SQL (sprawdzone testem integracyjnym: warstwa TS i RPC dają ten sam wynik).
- **Podwójne kliknięcie:** „Wyślij ponownie” w ciągu 10 s po udanej wysyłce niczego nie wysyła (odpowiedź
  `duplicate`). Nie obejmuje to dwóch żądań w locie jednocześnie — to znane, drobne ograniczenie.
- **Realtime:** lead i każda próba dostawy „dotykają” sesji (migracja 4), więc prezenter widzi „Kalkulacja wysłana”
  albo nieudaną próbę na żywo, a inne karty rozmówcy — zablokowany NIP. Dane osobowe nie przechodzą kanałem.
- **Reply-To:** adres logowania konsultanta (`auth.users`), pobierany administracyjnym API Auth po stronie serwera.
- **GUS przy zimnym starcie:** pierwsze zapytanie po starcie funkcji może przekroczyć limit 8 s i skończyć się
  „GUS niedostępny”; rozmowa toczy się dalej, a ponowienie uzupełnia dane.

Testy end-to-end (`npm run test:e2e`, poza `npm test`; krok 2.7):

- 23 scenariusze na prawdziwych Edge Functions, bazie i Mailpicie: `lookup-company` (GUS testowy, pamięć podręczna,
  limit 10 zmian NIP), `guest-session` (widok bez pól wewnętrznych), `request-calculation` (strażnicy, pierwsza wysyłka,
  mail w marce, załącznik odczytany jak w Excelu, podwójne kliknięcie, zamrożenie, blokady, limit 3 z parytetem SQL).
- Skrypt dostarcza klucze lokalne ze `supabase status` przez zmienne procesu; nic nie trafia do repozytorium.
  Testy zostawiają dane w bazie, więc przed `npm run test:db` potrzebny jest `supabase db reset`.
- **Znalezisko e2e (migracja 5):** dwie równoległe sesje tej samej organizacji, które jednocześnie wpisały NOWY NIP,
  dawały jednej z nich błąd 500 (naruszenie unikalności `(org_id, nip)`). `attach_company_to_session` używa teraz
  `on conflict do nothing` i korzysta z wiersza konkurenta.
- Nie objęte: awaria dostawcy poczty (wymaga restartu funkcji z innym środowiskiem; pokryta testem adaptera i ręcznie),
  prawdziwy MailerSend i widok mobilny.

## Infrastruktura

- GitHub: organizacja MIC4ATAI, repozytorium `atai-calculator` (prywatne).
- Supabase: osobna organizacja i projekt, region Frankfurt; umowa powierzenia (DPA).
- Vercel: na start konto Hobby wyłącznie do budowy i testów; **przed pierwszą rozmową
  z prawdziwym klientem team na planie Pro i transfer projektu.**
- MailerSend: weryfikacja domeny nadawcy (SPF/DKIM).

### Przed pierwszą rozmową z prawdziwym klientem

Rzeczy znane z etapu 1, które trzeba zamknąć przed produkcją:

- **Wdrożenie Edge Function `guest-session`:** lokalnie `supabase functions serve` importuje
  `src/calc` spoza katalogu funkcji bez problemu, ale `supabase functions deploy` bundluje inaczej —
  sprawdzić przy pierwszym wdrożeniu. Awaryjnie: skrypt kopiujący `src/calc` do
  `supabase/functions/_shared/` przed wdrożeniem (bez ręcznie utrzymywanych kopii).
- **Limit zapytań** do `guest-session` (na IP / token) na poziomie bramy; dziś chroni ją tylko
  192-bitowy token i limit rozmiaru ciała (16 KB).
- **Auth produkcyjny:** adresy przekierowań i limit wysyłki maili ustawić w panelu Supabase (lokalny
  `config.toml` ma limit podniesiony do 30/h tylko na potrzeby testów); polski szablon maila z magic
  linkiem (domyślny jest angielski), własny SMTP / MailerSend.
- **Usuwanie danych na żądanie (RODO):** sesje z historią są nieusuwalne z założenia — przygotować
  osobną, udokumentowaną procedurę (migracja z jawnym wyłączeniem triggera dla konkretnych rekordów).
- **Marka organizacji** (logo, kolory, nadawca maili, osoba konsultanta) w widoku rozmówcy —
  zgodnie z sekcją „SaaS”; etap 1 pokazuje neutralny widok.

### Stan etapu 3 (w toku)

Spik techniczny (2026-11-11, kod jednorazowy usunięty): z kontenera Edge Runtime działa `fetch` do hosta
(`host.docker.internal`), `EdgeRuntime.waitUntil` dokańcza zadanie po wysłaniu odpowiedzi (odpowiedź po 0,1 s,
żądanie w tle po 2 s) i `crypto.subtle` liczy HMAC-SHA256 identyczny z Node.

Model danych (migracja 6): `session_visits` (wizyta klienta po zamrożeniu stanu; nowa po 30 min ciszy; tabela
operacyjna, dowodem zmian pozostaje niezmienny `calc_events`), `notification_outbox` (alerty do wysłania; zero
dostępu dla klientów, tylko serwer przez RPC `claim_notifications` / `finish_notification`, do 5 prób),
`profiles.notify_channel` i `notify_target` (Telegram chat id, oba pola albo żadne). Rejestrację aktywności robi baza:
RPC `record_guest_visit` (otwarcie strony) i trigger zmian danych bez JWT (aktor `guest`, jak w dzienniku zmian).
`restore_session_to_snapshot` przywraca dane i miks ze snapshotu; zmiany zapisuje dziennik jako zmiany rozmówcy.
Test pgTAP `07_followup.sql` (73 asercje) obejmuje RLS, okno 30 min, jeden alert na wizytę, restore, outbox i profil.

Logika follow-upu (krok 3.2, `src/followup/`, współdzielona z Edge Function): `readConversation` czyta liczby zapisane
w snapshocie (uszkodzony snapshot = brak paska, widok działa dalej), `compareToConversation` zestawia je z bieżącą
symulacją policzoną przez `src/calc` (zmiana danych albo miksu, różnice godzin i klientów, znacznik innej wersji
logiki), a `buildTimeline` grupuje zmiany po zamrożeniu w wizyty klienta (zmiany konsultanta i zdarzenia spoza okna
wizyty trafiają osobno, żeby nie wyglądały na działania klienta). Klient dostaje w `GuestView.followUp` tylko godziny,
miks, datę i wersję, bez kosztów i cichych założeń; wynik ukryty przez konsultanta ukrywa też follow-up. Żądania
rozmówcy: `get` z flagą `visit` (tylko przy otwarciu strony) i akcja `restore` (bez danych, wyłącznie ze snapshotu).


Widok klienta po CTA (krok 3.3): `guest-session` czyta snapshot do `GuestView.followUp`, rejestruje wizytę przy `get` z
flagą `visit` (błąd rejestracji tylko się loguje, odczyt się nie psuje) i obsługuje `restore` (404 nieznana sesja,
409 `no_snapshot`). Strona wysyła `visit` przy pierwszym udanym wczytaniu i przy każdym powrocie do karty; odświeżenia
Realtime i odzyskanie łączności wizyty nie tworzą. Stały pasek „Wynik z rozmowy” pokazuje liczby ze snapshotu, bieżącą
symulację z różnicą i przycisk „Wróć do stanu z rozmowy” (aktywny tylko przy zmianie; porzuca niezapisane wpisy i czeka
na zapis w drodze, żeby go nie nadpisać). Test e2e: `src/e2e/followup.e2e.test.ts`.

Widok konsultanta (krok 3.4): trasa `/session/:id/follow-up` (link z bloku „Kalkulacja wysłana” i plakietka „Klient wrócił · N×”
na liście sesji) zestawia w trzech kolumnach stan z rozmowy (snapshot), ostatnią symulację klienta (bieżące dane
policzone przez `src/calc`, różnice godzin, klientów i przychodu, zmienione pola podświetlone) i zmiany po rozmowie
pogrupowane w wizyty. Dane czyta RLS (snapshot, `calc_events` po zamrożeniu, `session_visits`), a widok odświeża się
na żywo po każdej zmianie wiersza sesji (nowa wizyta „dotyka” sesji). Logika: `src/followup/presenterView.ts`.
