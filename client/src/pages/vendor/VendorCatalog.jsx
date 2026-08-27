import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import api from "../../lib/api";
import { formatINR } from "../../lib/currency";
import ConfirmDialog from "../../components/ConfirmDialog";
import ProductImage from "../../components/ProductImage";

export default function VendorCatalog() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productToDelete, setProductToDelete] = useState(null);

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
    load();
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-bold">My catalog</h1>
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            {products.length} product{products.length !== 1 && "s"} listed
          </p>
        </div>
        <Link
          to="/vendor/add-product"
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2.5 rounded-lg focus-ring"
          style={{ background: "var(--primary)" }}
        >
          <Plus size={16} /> Add product
        </Link>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {loading ? (
          <div className="p-10 text-center text-sm" style={{ color: "var(--ink-soft)" }}>Loading…</div>
        ) : products.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>
                <th className="px-6 py-3 font-medium">Product</th>
                <th className="px-6 py-3 font-medium">Category</th>
                <th className="px-6 py-3 font-medium">Price</th>
                <th className="px-6 py-3 font-medium">Stock</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
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
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        to={`/vendor/edit-product/${p.id}`}
                        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ color: "var(--primary)", border: "1px solid var(--border)" }}
                      >
                        <Pencil size={13} /> Edit
                      </Link>
                      <button
                        onClick={() => setProductToDelete(p)}
                        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg focus-ring"
                        style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-14">
            <p className="text-sm mb-3" style={{ color: "var(--ink-soft)" }}>Nothing in your catalog yet.</p>
            <Link to="/vendor/add-product" className="text-sm font-semibold" style={{ color: "var(--primary)" }}>
              Add your first product →
            </Link>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(productToDelete)}
        title="Delete product?"
        message={`Remove ${productToDelete?.name || "this product"} from your catalog? This cannot be undone.`}
        confirmLabel="Delete product"
        onConfirm={handleDelete}
        onCancel={() => setProductToDelete(null)}
      />
    </div>
  );
}
