import { seasonOptions } from "../lib/season";
import type { SeasonMonth } from "@/src/server/types/anime";

export function SeasonSelector({
  value,
  onChange
}: {
  value: SeasonMonth;
  onChange: (season: SeasonMonth) => void;
}) {
  return (
    <div className="segmented" aria-label="季度选择">
      {seasonOptions.map((option) => (
        <button
          aria-pressed={value === option.value}
          className="segmentedButton"
          data-active={value === option.value}
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
