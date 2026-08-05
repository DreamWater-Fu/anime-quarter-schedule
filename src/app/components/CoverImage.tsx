"use client";

import { useState } from "react";
import type { AnimeItem } from "@/src/server/types/anime";

export function CoverImage({ item }: { item: AnimeItem }) {
  const [failed, setFailed] = useState(false);
  const src = item.coverImage?.medium ?? item.coverImage?.small ?? item.coverImage?.large;
  const title = item.title.chinese || item.title.japanese || item.title.original;

  if (!src || failed) {
    return (
      <div className="coverPlaceholder" aria-label={`${title} 封面待确认`}>
        <span>{title.slice(0, 1)}</span>
      </div>
    );
  }

  return (
    <img
      alt={`${title} 封面`}
      className="coverImage"
      loading="lazy"
      referrerPolicy="no-referrer"
      src={src}
      onError={() => setFailed(true)}
    />
  );
}
