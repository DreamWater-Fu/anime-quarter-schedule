import type { UserAnimePrefsControls } from "../lib/userAnimePrefs";
import type { AnimeItem } from "@/src/server/types/anime";

type ActionAnimeItem = Pick<AnimeItem, "id" | "title" | "status">;

export function UserAnimeActionButton({
  item,
  userPrefs
}: {
  item: ActionAnimeItem;
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
    const isCompleted = userPrefs.completedIds.has(item.id);
    const isWatching = userPrefs.watchingIds.has(item.id);

    if (isCompleted) {
      return (
        <button
          aria-label={`\u53d6\u6d88\u5df2\u89c2\u6bd5 ${title}`}
          aria-pressed={true}
          className="userActionButton"
          data-active={true}
          data-kind="completed"
          disabled={!userPrefs.isLoaded}
          type="button"
          onClick={() => userPrefs.toggleCompleted(item.id)}
        >
          {"\u5df2\u89c2\u6bd5"}
        </button>
      );
    }

    return (
      <span className="userActionGroup">
        <button
          aria-label={`${isWatching ? "\u53d6\u6d88\u5728\u770b" : "\u6807\u8bb0\u5728\u770b"} ${title}`}
          aria-pressed={isWatching}
          className="userActionButton"
          data-active={isWatching}
          data-kind="watching"
          disabled={!userPrefs.isLoaded}
          type="button"
          onClick={() => userPrefs.toggleWatching(item.id)}
        >
          {isWatching ? "\u5df2\u5728\u770b" : "\u5728\u770b"}
        </button>
        <button
          aria-label={`\u6807\u8bb0\u89c2\u6bd5 ${title}`}
          aria-pressed={false}
          className="userActionButton"
          data-active={false}
          data-kind="completed"
          disabled={!userPrefs.isLoaded}
          type="button"
          onClick={() => userPrefs.toggleCompleted(item.id)}
        >
          {"\u89c2\u6bd5"}
        </button>
      </span>
    );
  }

  return <span className="userActionEmpty" aria-hidden="true">-</span>;
}
