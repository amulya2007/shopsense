export default function StatCard({ icon: Icon, label, value, accent = "primary" }) {
  const colorMap = {
    primary: "var(--primary)",
    accent: "var(--accent)",
    success: "var(--success)",
    danger: "var(--danger)",
    pending: "var(--pending)",
  };
  const color = colorMap[accent] || colorMap.primary;

  return (
    <div
      className="flex min-w-0 items-center gap-3 rounded-xl p-3 sm:gap-4 sm:p-5"
      style={{ background: "var(--card)", border: "1px solid var(--border)", borderLeft: `4px solid ${color}` }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10"
        style={{ background: `${color}1a`, color }}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono-stat max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold leading-tight sm:text-xl xl:text-2xl" title={String(value)}>{value}</div>
        <div className="mt-0.5 break-words text-xs" style={{ color: "var(--ink-soft)" }}>{label}</div>
      </div>
    </div>
  );
}
