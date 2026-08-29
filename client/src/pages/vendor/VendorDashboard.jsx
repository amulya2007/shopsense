import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, DollarSign, ShoppingCart, Boxes, Plus, Package, ArrowRight } from "lucide-react";
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

  // Get current time of day greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="w-full">
      {/* Welcome Section */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold mb-1">
          {getGreeting()}, {user?.name?.split(" ")[0]}
        </h1>
        <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
          Here's what's happening with your store today
        </p>
        <Link
          to="/vendor/add-product"
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg focus-ring transition-all hover:opacity-90"
          style={{ background: "var(--primary)", color: "white" }}
        >
          <Plus size={16} /> Add product
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard 
          icon={TrendingUp} 
          label="Total sales" 
          value={data?.totalSales ?? "…"} 
          accent="primary"
          trend="+12.5"
          trendLabel="vs last month"
        />
        <StatCard 
          icon={DollarSign} 
          label="Total revenue" 
          value={formatINR(data?.totalRevenue)} 
          accent="accent"
          trend="+8.2"
          trendLabel="vs last month"
        />
        <StatCard 
          icon={ShoppingCart} 
          label="Total transactions" 
          value={data?.totalTransactions ?? "…"} 
          accent="success"
          trend="+15.7"
          trendLabel="vs last month"
        />
        <StatCard 
          icon={Boxes} 
          label="Products listed" 
          value={data?.productsListed ?? "…"} 
          accent="pending"
        />
      </div>

      {/* Recent Products Section */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 className="font-display text-lg font-bold">Recent Products</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--ink-soft)" }}>
              Your {data?.recentProducts?.length ?? 0} most recently added products
            </p>
          </div>
          <Link 
            to="/vendor/catalog" 
            className="flex items-center gap-1.5 text-sm font-semibold hover:gap-2 transition-all" 
            style={{ color: "var(--primary)" }}
          >
            View all <ArrowRight size={14} />
          </Link>
        </div>

        {data?.recentProducts?.length ? (
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {data.recentProducts.slice(0, 8).map((product) => (
                <Link
                  key={product.id}
                  to={`/vendor/edit-product/${product.id}`}
                  className="group rounded-xl overflow-hidden transition-all hover:shadow-lg focus-ring"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  {/* Product Image */}
                  <div 
                    className="relative w-full overflow-hidden"
                    style={{ 
                      background: "linear-gradient(135deg, var(--surface) 0%, var(--card) 100%)",
                      aspectRatio: "1",
                    }}
                  >
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package size={48} style={{ color: "var(--border)" }} />
                      </div>
                    )}
                    
                    {/* Stock Badge */}
                    <div className="absolute top-2 right-2">
                      {product.stock === 0 ? (
                        <span 
                          className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md"
                          style={{ background: "var(--danger)", color: "white" }}
                        >
                          Out of stock
                        </span>
                      ) : product.stock <= 10 ? (
                        <span 
                          className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md"
                          style={{ background: "var(--pending)", color: "white" }}
                        >
                          Low stock
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Product Info */}
                  <div className="p-3">
                    <h3 className="font-semibold text-sm mb-1 line-clamp-2 min-h-[2.5rem]">
                      {product.name}
                    </h3>
                    
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono-stat font-bold text-base" style={{ color: "var(--primary)" }}>
                        {formatINR(product.price)}
                      </span>
                      <span 
                        className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                        style={{ background: "var(--primary-light)", color: "white" }}
                      >
                        {product.category}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs" style={{ color: "var(--ink-soft)" }}>
                      <span>Stock: {product.stock} units</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-16 px-6">
            <div 
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: "var(--surface)" }}
            >
              <Package size={32} style={{ color: "var(--ink-soft)" }} />
            </div>
            <h3 className="font-semibold mb-2">No products yet</h3>
            <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
              Start building your catalog by adding your first product
            </p>
            <Link 
              to="/vendor/add-product" 
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg focus-ring"
              style={{ background: "var(--primary)", color: "white" }}
            >
              <Plus size={16} /> Add your first product
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
