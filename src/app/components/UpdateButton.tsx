import type { UpdateStatusPayload } from "@/src/server/types/api";

export type UpdateButtonStatus = UpdateStatusPayload["status"] | "running";

const labelByStatus: Record<UpdateButtonStatus, string> = {
  idle: "更新数据",
  running: "更新中",
  success: "再次更新",
  failed: "重试更新"
};

export function UpdateButton({
  status,
  disabled,
  disabledReason,
  onClick
}: {
  status: UpdateButtonStatus;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  const isBusy = status === "running";
  const isDisabled = disabled || isBusy;
  return (
    <button
      aria-busy={isBusy}
      aria-describedby={disabledReason ? "update-button-disabled-reason" : undefined}
      className="primaryButton"
      disabled={isDisabled}
      title={disabledReason}
      type="button"
      onClick={onClick}
    >
      {isBusy ? <span className="buttonSpinner" aria-hidden="true" /> : null}
      {disabledReason && !isBusy ? "只读" : labelByStatus[status]}
      {disabledReason ? (
        <span className="srOnly" id="update-button-disabled-reason">
          {disabledReason}
        </span>
      ) : null}
    </button>
  );
}
