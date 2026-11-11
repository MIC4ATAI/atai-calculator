import type { InputValue } from './guestView';

interface Props {
  id: string;
  label: string;
  value: InputValue;
  onChange: (value: InputValue) => void;
  placeholder?: string;
  /** Jednostka po prawej stronie pola, np. „zł/rok”. */
  unit?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Wartość podpowiedziana (domyślna) — pole wyróżnione jak w prototypie. */
  suggested?: boolean;
}

/** Pole liczbowe: pusty tekst to „brak wartości”, w pozostałych przypadkach liczba. */
export function NumberField({ id, label, value, onChange, placeholder, unit, hint, min = 0, max, step, suggested }: Props) {
  const input = (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={suggested ? 'suggested' : undefined}
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        const n = Number(raw);
        onChange(raw === '' || !Number.isFinite(n) ? '' : n);
      }}
    />
  );

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {unit ? (
        <div className="unit">
          {input}
          <span>{unit}</span>
        </div>
      ) : (
        input
      )}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
