import { AnimeTable } from "./AnimeTable";
import type { SortMode } from "../lib/listing";
import type { UserAnimePrefsControls } from "../lib/userAnimePrefs";
import type { AnimeItem, SeasonKey } from "@/src/server/types/anime";

export function ScheduleBoard({
  items,
  currentSeason,
  sortMode,
  userPrefs,
  title = "\u7edf\u8ba1\u5217\u8868",
  description,
  ariaLabel = "\u7edf\u8ba1\u5217\u8868",
  onSortModeChange
}: {
  items: AnimeItem[];
  currentSeason: SeasonKey;
  sortMode: SortMode;
  userPrefs: UserAnimePrefsControls;
  title?: string;
  description?: string;
  ariaLabel?: string;
  onSortModeChange: (sortMode: SortMode) => void;
}) {
  const summary = description ?? `\u5f53\u524d\u7b5b\u9009\u4e0b\u5171 ${items.length} \u90e8`;

  return (
    <section className="scheduleGroup" aria-label={ariaLabel}>
      <div className="groupHeader">
        <div>
          <h2>{title}</h2>
          <p>{summary}</p>
        </div>
      </div>

      <AnimeTable
        currentSeason={currentSeason}
        items={items}
        sortMode={sortMode}
        userPrefs={userPrefs}
        onSortModeChange={onSortModeChange}
      />
    </section>
  );
}
