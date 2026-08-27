import { useEffect, useState } from "react";
import { Check, Ban, RotateCcw, Trash2 } from "lucide-react";
import api from "../../lib/api";
import StatusBadge from "../../components/StatusBadge";
import ConfirmDialog from "../../components/ConfirmDialog";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "suspended", label: "Suspended" },
];

export default function AdminVendors() {
  const [vendors, setVendors] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [vendorToDelete, setVendorToDelete] = useState(null);

  const load = (status = filter) => {
    setLoading(true);
    api.get("/admin/vendors", { params: { status } }).then((res) => {
      setVendors(res.data);
      setLoading(false);
    });
  };

  useEffect(() => load(filter), [filter]);

  const updateStatus = async (id, status) => {
    await api.put(`/admin/vendors/${id}/status`, { status });
    load();
  };

  const deleteVendor = async () => {
    if (!vendorToDelete) return;
    await api.delete(`/admin/vendors/${vendorToDelete.id}`);
    setVendorToDelete(null);
    load();
  };

  return (
    <div className="w-full">
      <h1 className="font-display text-xl font-bold mb-1">Vendor management</h1>
      <p className="text-sm mb-6" style={{ color: "var(--ink-soft)" }}>
        Review applications and manage vendor account status.
      </p>

      <div className="flex gap-1 p-1 rounded-xl mb-6 w-fit" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition focus-ring"
            style={filter === f.key ? { background: "var(--primary)", color: "white" } : { color: "var(--ink-soft)" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {loading ? (
          <div className="p-10 text-center text-sm" style={{ color: "var(--ink-soft)" }}>Loading…</div>
        ) : vendors.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>
                <th className="px-6 py-3 font-medium">Vendor</th>
                <th className="px-6 py-3 font-medium">Business</th>
                <th className="px-6 py-3 font-medium">Email</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-6 py-3 font-medium">{v.full_name}</td>
                  <td className="px-6 py-3" style={{ color: "var(--ink-soft)" }}>{v.business_name}</td>
                  <td className="px-6 py-3" style={{ color: "var(--ink-soft)" }}>{v.email}</td>
                  <td className="px-6 py-3"><StatusBadge status={v.status} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-2">
                      {v.status !== "approved" && (
                        <button
                          onClick={() => updateStatus(v.id, "approved")}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg focus-ring"
                          style={{ color: "var(--success)", background: "var(--success-soft)" }}
                        >
                          <Check size={13} /> Approve
                        </button>
                      )}
                      {v.status !== "suspended" && (
                        <button
                          onClick={() => updateStatus(v.id, "suspended")}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg focus-ring"
                          style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
                        >
                          <Ban size={13} /> Suspend
                        </button>
                      )}
                      {v.status !== "pending" && (
                        <button
                          onClick={() => updateStatus(v.id, "pending")}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg focus-ring"
                          style={{ color: "#7a5719", background: "var(--pending-soft)" }}
                        >
                          <RotateCcw size={13} /> Reset
                        </button>
                      )}
                      <button
                        onClick={() => setVendorToDelete(v)}
                        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg focus-ring"
                        style={{ color: "var(--danger)", border: "1px solid var(--danger-soft)" }}
                        title="Remove vendor permanently"
                      >
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-10 text-center text-sm" style={{ color: "var(--ink-soft)" }}>No vendors in this filter.</div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(vendorToDelete)}
        title="Remove vendor?"
        message={`Permanently delete ${vendorToDelete?.business_name || "this vendor"}, including its products and sales data? This cannot be undone.`}
        confirmLabel="Remove vendor"
        onConfirm={deleteVendor}
        onCancel={() => setVendorToDelete(null)}
      />
    </div>
  );
}
