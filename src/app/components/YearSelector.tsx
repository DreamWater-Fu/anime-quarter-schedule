"use client";

import { useEffect, useState } from "react";

export function YearSelector({
  value,
  onChange
}: {
  value: number;
  onChange: (year: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <label className="field">
      <span>年份</span>
      <input
        aria-label="年份"
        inputMode="numeric"
        max={2100}
        min={1900}
        type="number"
        value={draft}
        onBlur={() => setDraft(String(value))}
        onChange={(event) => {
          const nextDraft = event.target.value;
          const nextYear = Number(nextDraft);
          setDraft(nextDraft);
          if (Number.isInteger(nextYear) && nextYear >= 1900 && nextYear <= 2100) {
            onChange(nextYear);
          }
        }}
      />
    </label>
  );
}
