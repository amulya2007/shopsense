export default function StatusBadge({ status }) {
  const map = {
    approved: { bg: "var(--success-soft)", fg: "var(--success)", label: "Approved" },
    pending: { bg: "var(--pending-soft)", fg: "#7a5719", label: "Pending" },
    suspended: { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Suspended" },
  };
  const s = map[status] || map.pending;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ background: s.bg, color: s.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.fg }} />
      {s.label}
    </span>
  );
}
