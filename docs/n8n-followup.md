# Alert o powrocie klienta: workflow n8n

Kalkulator wysyła do n8n krótki, podpisany webhook za każdym razem, gdy klient, który dostał kalkulację, **wraca do
swojej sesji** albo **zmienia dane** (jedno powiadomienie na wizytę, wizyta kończy się po 30 min ciszy). Workflow
weryfikuje podpis i wysyła konsultantowi wiadomość na Telegramie.

> **Status:** plik `docs/n8n-followup-workflow.json` to szablon do zaimportowania. Kod węzła weryfikującego podpis jest
> przetestowany na prawdziwych żądaniach z kalkulatora (`src/notify/n8nWorkflow.test.ts`), ale sam szablon **nie był
> jeszcze uruchomiony w żywej instancji n8n**. Po imporcie wykonaj próbę z sekcji „Sprawdzenie”.

## Co przychodzi (minimum + link)

Zgodnie z decyzją produktową do n8n nie trafiają dane leada: nazwa firmy, NIP, e-mail klienta ani wartości z kalkulacji.

```json
{
  "eventId": "ntf-42",
  "kind": "client_changed",
  "newVisit": false,
  "occurredAt": "2026-11-11T17:52:00.000Z",
  "organization": "MITAX Consulting sp. z o.o.",
  "consultantName": "Ola Konsultant",
  "sessionUrl": "https://atai.mitax.pl/session/<id>/follow-up",
  "changedFields": 2,
  "message": "MITAX Consulting sp. z o.o.: Klient zmienił dane w kalkulacji (zmienione pola: 2).",
  "channel": { "type": "telegram", "target": "123456789" }
}
```

- `kind`: `client_returned` (klient otworzył stronę) albo `client_changed` (zmienił dane; `newVisit: true`, gdy zmiana
  rozpoczęła wizytę, więc osobnego „wrócił” nie będzie).
- `sessionUrl` otwiera widok follow-up konsultanta (wymaga zalogowania).
- `message` jest gotowym tekstem alertu po polsku; workflow może wysłać go bez obróbki.

Nagłówki: `X-Timestamp` (sekundy, same cyfry), `X-Event-Id` (do deduplikacji), `X-Signature` =
`sha256=` + HMAC-SHA256(sekret, `<X-Timestamp>.<treść żądania>`).

## Konfiguracja

1. **n8n:** ustaw zmienną środowiskową `ATAI_WEBHOOK_SECRET` (losowy sekret, min. 16 znaków) oraz
   `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (węzeł Code korzysta z modułu `crypto`). Zaimportuj
   `docs/n8n-followup-workflow.json`, w węźle „Wyślij na Telegram” wskaż poświadczenia bota (token od @BotFather)
   i **aktywuj workflow** (adres produkcyjny webhooka działa tylko dla aktywnego; pamięć deduplikacji też).
2. **Supabase (funkcje):** `supabase secrets set N8N_WEBHOOK_URL=<produkcyjny adres webhooka z n8n>`
   `N8N_WEBHOOK_SECRET=<ten sam sekret co ATAI_WEBHOOK_SECRET>`. Adres musi być https. Bez `N8N_WEBHOOK_URL`
   wysyłka jest wyłączona (alerty czekają w outboxie).
3. **Konsultant:** w aplikacji, na stronie „Powiadomienia”, wpisuje identyfikator swojego czatu z botem (w grupach
   zaczyna się od minusa). Pusty identyfikator wyłącza alerty. Konsultant musi wcześniej napisać do bota, żeby bot mógł
   do niego pisać.

## Co robi workflow

1. **Webhook z kalkulatora:** POST, odpowiedź zwraca węzeł „Respond to Webhook” (kod HTTP zależy od wyniku).
2. **Sprawdź podpis i duplikaty:** odrzuca żądanie ze złym lub brakującym podpisem (401), ze znacznikiem czasu, który
   nie jest liczbą całkowitą, albo starszym niż 5 minut (401), oraz przy braku sekretu w n8n (500). Alert, który już
   obsłużono (ten sam `X-Event-Id`), kończy się odpowiedzią 200 bez wysyłki.
3. **Czy wysłać alert?** → **Wyślij na Telegram** (czat z pola `channel.target`, tekst `message` + `sessionUrl`)
   → **Odpowiedz 200**. Pozostałe przypadki: odpowiedź z kodem z kroku 2.

Odpowiedź inna niż 2xx oznacza dla kalkulatora ponowienie (do 5 prób). Dostarczanie jest „co najmniej raz”: gdy n8n
odpowie 200, a kalkulator nie zdąży zapisać potwierdzenia, ten sam alert może przyjść ponownie. Stąd deduplikacja po
`X-Event-Id` (workflow pamięta 500 ostatnich identyfikatorów w danych statycznych).

## Sprawdzenie

Z lokalnego terminala (podstaw swój adres, sekret i identyfikator czatu; sekret nie trafia do historii, jeśli
ustawisz go przez `read -s`):

```bash
read -s ATAI_SECRET; TS=$(date +%s)
BODY='{"eventId":"ntf-test-1","kind":"client_returned","newVisit":false,"occurredAt":"2026-11-11T17:52:00.000Z","organization":"Test","consultantName":null,"sessionUrl":"https://example.com/session/test/follow-up","changedFields":null,"message":"Test: Klient wrócił do kalkulacji.","channel":{"type":"telegram","target":"<twój chat id>"}}'
SIG="sha256=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$ATAI_SECRET" -hex | sed 's/^.* //')"
curl -i -X POST "<adres webhooka>" -H 'Content-Type: application/json' \
  -H "X-Timestamp: $TS" -H "X-Event-Id: ntf-test-1" -H "X-Signature: $SIG" --data "$BODY"
```

Oczekiwane: 200 i wiadomość na Telegramie. Powtórzenie tego samego polecenia: 200 bez drugiej wiadomości (duplikat).
Zmiana jednego znaku w `$BODY` po podpisaniu: 401.

## Uwaga prawna

Przez n8n (infrastrukturę operatora) przechodzą: nazwa organizacji, imię konsultanta, jego identyfikator czatu
i link do sesji. Nie są to dane leadów, ale są to dane osobowe konsultanta, więc powinny być ujęte w umowie powierzenia.
