# Prompt startowy dla Claude Code — etap 1 (MVP)

Wklej poniższy tekst w Claude Code w trybie planowania (Plan mode), w katalogu repozytorium.

---

Przeczytaj `CLAUDE.md` i `docs/spec.md`. Zaplanuj etap 1 (MVP) kalkulatora. Zanim napiszesz kod,
pokaż mi plan do akceptacji.

Zakres etapu 1:

1. **Szkielet aplikacji:** Vite + React + TypeScript w tym repozytorium, z zachowaniem istniejącego
   modułu `src/calc/` i jego testów (muszą dalej przechodzić).
2. **Supabase lokalnie** (Supabase CLI) i pierwsza migracja z tabelami: `organizations`,
   `profiles`, `memberships`, `calc_sessions`, `calc_snapshots`, `calc_events`, `usage_events`.
   Tabele `companies`, `leads`, `consents` zostaw na etap 2.
3. **Polityki RLS z testami** (np. pgTAP albo testy przez klienta Supabase) dla scenariuszy:
   konsultant widzi tylko swoje sesje; właściciel organizacji widzi całą organizację;
   organizacje nie widzą się nawzajem; `calc_snapshots` nie da się zmienić ani usunąć.
4. **Logowanie konsultanta** (Supabase Auth, magic link) i wybór organizacji, jeśli należy do kilku.
5. **Sesja na żywo:** konsultant tworzy sesję i dostaje link z nieodgadywalnym tokenem.
   Rozmówca otwiera link bez logowania i wpisuje dane; konsultant widzi je na bieżąco przez
   Supabase Realtime. Przebieg i treści jak w prototypie:
   https://claude.ai/artifact/3vuquvjRr9PT5MVD5W5dbD
   — w tym przycisk „Odsłoń wynik” po stronie konsultanta i suwak miksu klientów po obu stronach.
6. **Zliczanie użycia:** każda utworzona sesja zapisuje zdarzenie w `usage_events`.

Poza zakresem etapu 1: NIP i GUS, e-mail i Excel, zamrażanie stanu przy CTA, powiadomienia,
landing page, panel operatora.

Pracuj małymi krokami: po każdym kroku uruchom testy i typecheck, a potem zaproponuj commit.
