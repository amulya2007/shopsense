import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, DollarSign, ShoppingCart, Boxes, Plus } from "lucide-react";
import api from "../../lib/api";
import { formatINR } from "../../lib/currency";
import { useAuth } from "../../context/auth";
import StatCard from "../../components/StatCard";
import ProductImage from "../../components/ProductImage";

export default function VendorDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/vendor/dashboard").then((res) => setData(res.data));
  }, []);

  return (
    <div className="w-full">
      <div
        className="rounded-2xl p-6 mb-6 flex items-center justify-between"
        style={{ background: "var(--primary)" }}
      >
        <div>
          <h1 className="font-display text-xl font-bold text-white mb-1">
            Welcome back, {user?.name?.split(" ")[0]}
          </h1>
          <p className="text-sm" style={{ color: "var(--sidebar-soft)" }}>
            {user?.businessName} · Here's your business overview
          </p>
        </div>
        <Link
          to="/vendor/add-product"
          className="hidden sm:flex items-center gap-2 bg-white text-sm font-semibold px-4 py-2.5 rounded-lg focus-ring"
          style={{ color: "var(--primary)" }}
        >
          <Plus size={16} /> Add product
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={TrendingUp} label="Total sales" value={data?.totalSales ?? "…"} accent="primary" />
        <StatCard icon={DollarSign} label="Total revenue" value={formatINR(data?.totalRevenue)} accent="accent" />
        <StatCard icon={ShoppingCart} label="Total transactions" value={data?.totalTransactions ?? "…"} accent="success" />
        <StatCard icon={Boxes} label="Products listed" value={data?.productsListed ?? "…"} accent="pending" />
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 className="font-display text-sm font-bold">Recent products</h2>
            <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Your {data?.recentProducts?.length ?? 0} most recently added products
            </p>
          </div>
          <Link to="/vendor/catalog" className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
            View all →
          </Link>
        </div>

        {data?.recentProducts?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>
                <th className="px-6 py-2 font-medium">Product</th>
                <th className="px-6 py-2 font-medium">Category</th>
                <th className="px-6 py-2 font-medium">Price</th>
                <th className="px-6 py-2 font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {data.recentProducts.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <ProductImage src={p.image_url} alt={p.name} />
                      <div className="min-w-0">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs truncate max-w-xs" style={{ color: "var(--ink-soft)" }}>{p.description}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-xs font-semibold" style={{ color: "var(--primary)" }}>{p.category?.toUpperCase()}</td>
                  <td className="px-6 py-3 font-mono-stat">{formatINR(p.price)}</td>
                  <td className="px-6 py-3">{p.stock} units</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-14 px-6">
            <p className="text-sm mb-3" style={{ color: "var(--ink-soft)" }}>
              No products yet.
            </p>
            <Link to="/vendor/add-product" className="text-sm font-semibold" style={{ color: "var(--primary)" }}>
              Add your first product →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
