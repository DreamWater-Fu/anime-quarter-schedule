import type { UserAnimePrefsControls } from "../lib/userAnimePrefs";
import type { AnimeItem } from "@/src/server/types/anime";

export function UserAnimeActionButton({
  item,
  userPrefs
}: {
  item: AnimeItem;
  userPrefs: UserAnimePrefsControls;
}) {
  const title = item.title.chinese || item.title.japanese || item.title.original;

  if (item.status === "airing") {
    const active = userPrefs.followedIds.has(item.id);
    return (
      <button
        aria-label={`${active ? "\u53d6\u6d88\u8ffd\u756a" : "\u8ffd\u756a"} ${title}`}
        aria-pressed={active}
        className="userActionButton"
        data-active={active}
        data-kind="follow"
        disabled={!userPrefs.isLoaded}
        type="button"
        onClick={() => userPrefs.toggleFollow(item.id)}
      >
        {active ? "\u5df2\u8ffd\u756a" : "\u8ffd\u756a"}
      </button>
    );
  }

  if (item.status === "finished") {
    const active = userPrefs.completedIds.has(item.id);
    return (
      <button
        aria-label={`${active ? "\u53d6\u6d88\u5df2\u89c2\u6bd5" : "\u6807\u8bb0\u89c2\u6bd5"} ${title}`}
        aria-pressed={active}
        className="userActionButton"
        data-active={active}
        data-kind="completed"
        disabled={!userPrefs.isLoaded}
        type="button"
        onClick={() => userPrefs.toggleCompleted(item.id)}
      >
        {active ? "\u5df2\u89c2\u6bd5" : "\u89c2\u6bd5"}
      </button>
    );
  }

  return <span className="userActionEmpty" aria-hidden="true">-</span>;
}
