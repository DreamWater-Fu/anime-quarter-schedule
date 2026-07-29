import type { AnimeItem } from "@/src/server/types/anime";

export function BangumiBadge({ item }: { item: AnimeItem }) {
  if (item.bangumi.rating === null) {
    return (
      <div className="bangumiBadge" data-empty="true">
        <strong>暂无评分</strong>
        <span>{item.bangumi.subjectId === null ? "未匹配 Bangumi" : "暂无公开评分"}</span>
      </div>
    );
  }

  return (
    <div className="bangumiBadge">
      <strong>{item.bangumi.rating.toFixed(1)}</strong>
      <span>{item.bangumi.ratingCount === null ? "评分人数待确认" : `${item.bangumi.ratingCount} 人`}</span>
    </div>
  );
}
