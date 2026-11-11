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

## Model danych

| Tabela | Zawartość | Kto może zmieniać |
| --- | --- | --- |
| `organizations` | tenant: nazwa, NIP, marka (logo, kolory, nadawca maili), link do polityki prywatności, domyślne założenia kalkulatora | operator; marka i założenia także właściciel organizacji |
| `profiles` | osoba: imię i nazwisko, zdjęcie, telefon, podpis | sama osoba |
| `memberships` | osoba w organizacji i jej rola (właściciel / admin / konsultant) | operator, właściciel organizacji |
| `companies` | firmy rozmówców: NIP, REGON, nazwa, adres, surowa odpowiedź GUS | serwer |
| `leads` | `org_id`, konsultant, firma, e-mail podany do wysłania kalkulacji | serwer, tylko dopisywanie |
| `consents` | zgody z landing page organizacji: treść i wersja klauzuli, czas, IP, powiązanie z leadem | serwer, tylko dopisywanie |
| `calc_sessions` | `org_id`, konsultant, token linku, status (na żywo / udostępniona / zarchiwizowana) | serwer |
| `calc_snapshots` | zamrożone dane wejściowe, wyniki, miks, wersja logiki | tylko tworzenie |
| `calc_events` | dziennik zmian (rozmówca / konsultant) | tylko dopisywanie |
| `usage_events` | zliczanie użycia na potrzeby rozliczeń | serwer, tylko dopisywanie |

RLS: konsultant widzi swoje sesje i leady, właściciel i admin — całą organizację, organizacje
nie widzą się nawzajem, operator widzi tylko organizacje i użycie. Testy tych reguł są częścią
etapu 1.

## Kolejność pytań w rozmowie

Decyzja: NIP na początku rozmowy, e-mail dopiero przy CTA, zgody wyłącznie na landing page.

## Etapy budowy

| Etap | Co powstaje |
| --- | --- |
| 1. MVP | model wieloklientowy z RLS i testami, moduł obliczeń, widok rozmówcy i konsultanta, sesja na żywo (Supabase Realtime), zliczanie użycia |
| 2. Lead | NIP z walidacją i GUS, CTA z e-mailem, zamrożenie stanu, Excel, wysyłka maila w marce organizacji |
| 3. Follow-up | dziennik zmian, powiadomienia przez n8n, widok „rozmowa vs ostatnia symulacja” |
| 4. Reszta | landing page'e organizacji ze zgodami, panel operatora z rozliczeniem użycia, migracja kontaktów z LinkedIn |

## Infrastruktura

- GitHub: organizacja MIC4ATAI, repozytorium `atai-calculator` (prywatne).
- Supabase: osobna organizacja i projekt, region Frankfurt; umowa powierzenia (DPA).
- Vercel: na start konto Hobby wyłącznie do budowy i testów; **przed pierwszą rozmową
  z prawdziwym klientem team na planie Pro i transfer projektu.**
- MailerSend: weryfikacja domeny nadawcy (SPF/DKIM).
