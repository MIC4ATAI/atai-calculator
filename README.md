# atai-calculator

Kalkulator efektywności biura rachunkowego — aplikacja SaaS do prowadzenia rozmów sprzedażowych
na żywo: rozmówca wpisuje dane o swoim biurze, konsultant widzi je na bieżąco i odsłania wynik
(odzyskany czas i liczba nowych klientów, których biuro może obsłużyć bez dodatkowych etatów).

- Specyfikacja: [`docs/spec.md`](docs/spec.md)
- Zasady dla Claude Code: [`CLAUDE.md`](CLAUDE.md)
- Prompt startowy etapu 1: [`docs/etap-1-prompt.md`](docs/etap-1-prompt.md)
- Logika obliczeń i testy zgodności z arkuszem: [`src/calc/`](src/calc/)

```bash
npm install
npm test
```

© MITAX Consulting sp. z o.o. Wszelkie prawa zastrzeżone.
