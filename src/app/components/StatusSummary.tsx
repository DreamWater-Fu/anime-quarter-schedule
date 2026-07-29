import type { AnimeSeasonPayload } from "@/src/server/types/anime";

export function StatusSummary({ data }: { data: AnimeSeasonPayload | null }) {
  return (
    <section className="summaryGrid" aria-label="摘要信息">
      <SummaryItem label="当前作品" value={`${data?.meta.total ?? 0}`} />
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
