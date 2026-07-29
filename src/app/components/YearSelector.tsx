export function YearSelector({
  value,
  onChange
}: {
  value: number;
  onChange: (year: number) => void;
}) {
  return (
    <label className="field">
      <span>年份</span>
      <input
        aria-label="年份"
        inputMode="numeric"
        max={2100}
        min={1900}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
