import type { ViewMode } from "../lib/listing";

const viewModes: Array<{ value: ViewMode; label: string; description: string }> = [
  { value: "stats", label: "统计列表", description: "查看当前季度作品" },
  { value: "following", label: "追番列表", description: "按周几看连载更新" },
  { value: "personalFollowing", label: "个人追番", description: "只看已追番作品" },
  { value: "watching", label: "在看记录", description: "标记未看完的完结作品" },
  { value: "watchHistory", label: "观看记录", description: "回看已观毕作品" }
];

export function ViewModeSwitcher({
  value,
  onChange
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}) {
  return (
    <section className="modePanel" aria-label="浏览模式">
      <span className="modeLabel">浏览模式</span>
      <div className="modeSwitcher" aria-label="浏览模式">
        {viewModes.map((mode) => (
          <button
            aria-pressed={value === mode.value}
            aria-label={`${mode.label}：${mode.description}`}
            className="modeButton"
            data-active={value === mode.value}
            data-mode={mode.value}
            key={mode.value}
            title={mode.description}
            type="button"
            onClick={() => onChange(mode.value)}
          >
            <span>{mode.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
