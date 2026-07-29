import type { UpdateStatusPayload } from "@/src/server/types/api";

export type UpdateButtonStatus = UpdateStatusPayload["status"] | "running";

const labelByStatus: Record<UpdateButtonStatus, string> = {
  idle: "更新数据",
  running: "更新中",
  success: "已更新",
  failed: "重试更新"
};

export function UpdateButton({
  status,
  disabled,
  onClick
}: {
  status: UpdateButtonStatus;
  disabled?: boolean;
  onClick: () => void;
}) {
  const isBusy = status === "running";
  return (
    <button
      aria-busy={isBusy}
      className="primaryButton"
      disabled={disabled || isBusy}
      type="button"
      onClick={onClick}
    >
      {isBusy ? <span className="buttonSpinner" aria-hidden="true" /> : null}
      {labelByStatus[status]}
    </button>
  );
}
