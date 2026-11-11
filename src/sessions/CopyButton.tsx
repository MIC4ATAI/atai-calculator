import { useEffect, useRef, useState } from 'react';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // brak uprawnień / kontekst niezabezpieczony — użytkownik skopiuje ręcznie
  }
}

/** Kopiuje tekst do schowka i na chwilę potwierdza. Przy błędzie podpowiada ręczne kopiowanie. */
export function CopyButton({ text, label = 'Kopiuj link' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onClick() {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2500);
  }

  return (
    <button type="button" onClick={onClick} aria-live="polite">
      {state === 'copied' ? 'Skopiowano' : state === 'failed' ? 'Zaznacz i skopiuj ręcznie' : label}
    </button>
  );
}
