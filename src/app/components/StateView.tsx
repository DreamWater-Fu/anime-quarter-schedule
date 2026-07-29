export function StateView({
  type,
  title,
  description,
  actionLabel,
  onAction
}: {
  type: "loading" | "error" | "empty" | "partial" | "updating" | "success";
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="stateView" data-type={type} role={type === "error" ? "alert" : "status"}>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <button className="secondaryButton" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

export function SkeletonRows() {
  return (
    <div className="skeletonList" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="skeletonRow" key={index}>
          <div />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
