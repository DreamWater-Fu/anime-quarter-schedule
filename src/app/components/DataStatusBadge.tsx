import { dataStatusLabels } from "../lib/format";
import type { DataStatus } from "@/src/server/types/anime";

export function DataStatusBadge({ status }: { status: DataStatus }) {
  return (
    <span className="badge" data-tone={status === "conflicting" ? "danger" : status === "complete" ? "neutral" : "warn"}>
      {dataStatusLabels[status]}
    </span>
  );
}
