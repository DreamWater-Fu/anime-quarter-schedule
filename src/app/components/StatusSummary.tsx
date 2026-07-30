import type { AnimeSeasonPayload } from "@/src/server/types/anime";
import type { UpdateStatusPayload } from "@/src/server/types/api";

export function StatusSummary({
  data,
  updateState
}: {
  data: AnimeSeasonPayload | null;
  updateState: UpdateStatusPayload;
}) {
  return (
    <section className="summaryGrid" aria-label="摘要信息">
      <SummaryItem label="当前季度作品" value={`${data?.meta.total ?? 0}`} />
      <SummaryItem label="全库缓存" value={`${updateState.cache.itemCount}`} />
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summaryItem">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
