import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Trash2, Search, Filter, Package, Grid3x3, List } from "lucide-react";
import api from "../../lib/api";
import { formatINR } from "../../lib/currency";
import ConfirmDialog from "../../components/ConfirmDialog";
import StatusBadge from "../../components/StatusBadge";

export default function VendorCatalog() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productToDelete, setProductToDelete] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"

  const load = () => {
    setLoading(true);
    api.get("/vendor/products").then((res) => {
      setProducts(res.data);
      setLoading(false);
    });
  };

  useEffect(load, []);

  const handleDelete = async () => {
    if (!productToDelete) return;
    await api.delete(`/vendor/products/${productToDelete.id}`);
    setProductToDelete(null);
    window.dispatchEvent(new Event("inventory-updated"));
    load();
  };

  // Get unique categories
  const categories = ["all", ...new Set(products.map(p => p.category).filter(Boolean))];

  // Filter products
  const filteredProducts = products.filter(product => {
    const matchesSearch = !searchQuery || 
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = categoryFilter === "all" || product.category === categoryFilter;
    
    const matchesStock = stockFilter === "all" || 
      (stockFilter === "in-stock" && product.stock > 10) ||
      (stockFilter === "low-stock" && product.stock > 0 && product.stock <= 10) ||
      (stockFilter === "out-of-stock" && product.stock === 0);
    
    return matchesSearch && matchesCategory && matchesStock;
  });

  const getStockStatus = (stock) => {
    if (stock === 0) return "out-of-stock";
    if (stock <= 10) return "low-stock";
    return "in-stock";
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold">My Catalog</h1>
          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
            {filteredProducts.length} of {products.length} product{products.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          to="/vendor/add-product"
          className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg focus-ring transition-all hover:opacity-90"
          style={{ background: "var(--primary)", color: "white" }}
        >
          <Plus size={16} /> Add product
        </Link>
      </div>

      {/* Filters and Search */}
      <div className="rounded-xl p-4 mb-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Search */}
          <div className="md:col-span-2 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-soft)" }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm focus-ring"
              style={{ border: "1px solid var(--border)" }}
            />
          </div>

          {/* Category Filter */}
          <div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm focus-ring"
              style={{ border: "1px solid var(--border)" }}
            >
              <option value="all">All Categories</option>
              {categories.filter(c => c !== "all").map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>

          {/* Stock Filter */}
          <div>
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm focus-ring"
              style={{ border: "1px solid var(--border)" }}
            >
              <option value="all">All Stock Status</option>
              <option value="in-stock">In Stock</option>
              <option value="low-stock">Low Stock</option>
              <option value="out-of-stock">Out of Stock</option>
            </select>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center justify-end gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="text-xs font-medium mr-2" style={{ color: "var(--ink-soft)" }}>View:</span>
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 rounded-lg transition-all ${viewMode === "grid" ? "bg-primary/10" : ""}`}
            style={{ border: "1px solid var(--border)", color: viewMode === "grid" ? "var(--primary)" : "var(--ink-soft)" }}
          >
            <Grid3x3 size={16} />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 rounded-lg transition-all ${viewMode === "list" ? "bg-primary/10" : ""}`}
            style={{ border: "1px solid var(--border)", color: viewMode === "list" ? "var(--primary)" : "var(--ink-soft)" }}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Products Grid/List */}
      {loading ? (
        <div 
          className="rounded-xl p-16 text-center"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Loading products...</p>
        </div>
      ) : filteredProducts.length ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="group rounded-xl overflow-hidden transition-all hover:shadow-lg"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
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
                    <StatusBadge status={getStockStatus(product.stock)} />
                  </div>
                </div>

                {/* Product Info */}
                <div className="p-4">
                  <h3 className="font-semibold text-sm mb-2 line-clamp-2 min-h-[2.5rem]">
                    {product.name}
                  </h3>
                  
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono-stat font-bold text-lg" style={{ color: "var(--primary)" }}>
                      {formatINR(product.price)}
                    </span>
                    <span 
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded"
                      style={{ background: "var(--primary-light)", color: "white" }}
                    >
                      {product.category}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs mb-3 pb-3" style={{ color: "var(--ink-soft)", borderBottom: "1px solid var(--border)" }}>
                    <span>Stock: {product.stock} units</span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Link
                      to={`/vendor/edit-product/${product.id}`}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg focus-ring transition-all hover:opacity-80"
                      style={{ background: "var(--primary)", color: "white" }}
                    >
                      <Pencil size={12} /> Edit
                    </Link>
                    <button
                      onClick={() => setProductToDelete(product)}
                      className="flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg focus-ring transition-all hover:opacity-80"
                      style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-soft)", background: "var(--surface)" }}>
                  <th className="px-6 py-3 font-semibold">Product</th>
                  <th className="px-6 py-3 font-semibold">Category</th>
                  <th className="px-6 py-3 font-semibold">Price</th>
                  <th className="px-6 py-3 font-semibold">Stock</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-12 h-12 rounded-lg overflow-hidden shrink-0"
                          style={{ background: "var(--surface)" }}
                        >
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package size={20} style={{ color: "var(--border)" }} />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold">{product.name}</div>
                          <div className="text-xs truncate max-w-md mt-0.5" style={{ color: "var(--ink-soft)" }}>
                            {product.description}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span 
                        className="text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: "var(--primary-light)", color: "white" }}
                      >
                        {product.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono-stat font-semibold">
                      {formatINR(product.price)}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm">{product.stock} units</span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={getStockStatus(product.stock)} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/vendor/edit-product/${product.id}`}
                          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg focus-ring transition-all hover:opacity-80"
                          style={{ background: "var(--primary)", color: "white" }}
                        >
                          <Pencil size={12} /> Edit
                        </Link>
                        <button
                          onClick={() => setProductToDelete(product)}
                          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg focus-ring transition-all hover:opacity-80"
                          style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div 
          className="rounded-xl text-center py-16 px-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div 
            className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ background: "var(--surface)" }}
          >
            <Package size={32} style={{ color: "var(--ink-soft)" }} />
          </div>
          <h3 className="font-semibold text-lg mb-2">
            {searchQuery || categoryFilter !== "all" || stockFilter !== "all" 
              ? "No products found" 
              : "No products in catalog"}
          </h3>
          <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
            {searchQuery || categoryFilter !== "all" || stockFilter !== "all"
              ? "Try adjusting your filters or search query"
              : "Start building your catalog by adding your first product"}
          </p>
          {!(searchQuery || categoryFilter !== "all" || stockFilter !== "all") && (
            <Link 
              to="/vendor/add-product" 
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg focus-ring"
              style={{ background: "var(--primary)", color: "white" }}
            >
              <Plus size={16} /> Add your first product
            </Link>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(productToDelete)}
        title="Delete product?"
        message={`Remove "${productToDelete?.name}" from your catalog? This action cannot be undone.`}
        confirmLabel="Delete product"
        onConfirm={handleDelete}
        onCancel={() => setProductToDelete(null)}
      />
    </div>
  );
}
