export default function StatusBadge({ status }) {
  const map = {
    // Vendor approval statuses
    approved: { bg: "var(--success-soft)", fg: "var(--success)", label: "Approved" },
    pending: { bg: "var(--pending-soft)", fg: "#7a5719", label: "Pending" },
    suspended: { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Suspended" },
    
    // Stock statuses
    "in-stock": { bg: "var(--success-soft)", fg: "var(--success)", label: "In Stock" },
    "low-stock": { bg: "var(--pending-soft)", fg: "#7a5719", label: "Low Stock" },
    "out-of-stock": { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Out of Stock" },
  };
  const s = map[status] || map.pending;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md"
      style={{ background: s.bg, color: s.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.fg }} />
      {s.label}
    </span>
  );
}
