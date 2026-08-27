import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Clock, ShieldCheck, ShieldOff } from "lucide-react";
import api from "../../lib/api";
import StatCard from "../../components/StatCard";
import StatusBadge from "../../components/StatusBadge";

export default function AdminDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/admin/dashboard").then((res) => setData(res.data));
  }, []);

  return (
    <div className="w-full">
      <h1 className="font-display text-xl font-bold mb-1">Admin dashboard</h1>
      <p className="text-sm mb-6" style={{ color: "var(--ink-soft)" }}>
        Marketplace vendor status and platform metrics
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Users} label="Total vendors" value={data?.totalVendors ?? "…"} accent="primary" />
        <StatCard icon={Clock} label="Pending approval" value={data?.pending ?? "…"} accent="pending" />
        <StatCard icon={ShieldCheck} label="Approved vendors" value={data?.approved ?? "…"} accent="success" />
        <StatCard icon={ShieldOff} label="Suspended vendors" value={data?.suspended ?? "…"} accent="danger" />
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 className="font-display text-sm font-bold">Recent vendors</h2>
            <p className="text-xs" style={{ color: "var(--ink-soft)" }}>Latest vendor applications and accounts</p>
          </div>
          <Link to="/admin/vendors" className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
            Manage all →
          </Link>
        </div>

        {data?.recentVendors?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>
                <th className="px-6 py-2 font-medium">Vendor</th>
                <th className="px-6 py-2 font-medium">Business</th>
                <th className="px-6 py-2 font-medium">Email</th>
                <th className="px-6 py-2 font-medium">Status</th>
                <th className="px-6 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.recentVendors.map((v) => (
                <tr key={v.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-6 py-3 font-medium">{v.full_name}</td>
                  <td className="px-6 py-3" style={{ color: "var(--ink-soft)" }}>{v.business_name}</td>
                  <td className="px-6 py-3" style={{ color: "var(--ink-soft)" }}>{v.email}</td>
                  <td className="px-6 py-3"><StatusBadge status={v.status} /></td>
                  <td className="px-6 py-3 text-xs" style={{ color: "var(--ink-soft)" }}>
                    {new Date(v.joined_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-14 text-sm" style={{ color: "var(--ink-soft)" }}>No vendors yet.</div>
        )}
      </div>
    </div>
  );
}
