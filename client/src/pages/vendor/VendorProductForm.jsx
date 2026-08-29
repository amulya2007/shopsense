import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ImageUp, Sparkles, Loader2, AlertCircle } from "lucide-react";
import api from "../../lib/api";
import ProductImage from "../../components/ProductImage";

const CATEGORIES = ["Accessories", "Audio", "Computers", "Electronics", "Wearables", "Clothing", "Home & Garden", "Beauty", "Sports", "Groceries", "Other"];

async function createProductImageData(file) {
  const imageUrl = URL.createObjectURL(file);
  const image = await new Promise((resolve, reject) => {
    const preview = new Image();
    preview.onload = () => resolve(preview);
    preview.onerror = reject;
    preview.src = imageUrl;
  });
  URL.revokeObjectURL(imageUrl);

  let width = Math.min(image.naturalWidth, 700);
  let height = Math.round(image.naturalHeight * (width / image.naturalWidth));
  let output = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    output = canvas.toDataURL("image/jpeg", Math.max(0.4, 0.8 - attempt * 0.15));
    if (output.length <= 80000) break;
    width = Math.round(width * 0.75);
    height = Math.round(height * 0.75);
  }
  if (output.length > 80000) throw new Error("Image is too large after optimisation.");
  return output;
}

export default function VendorProductForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "",
    price: "",
    stock: "",
    imageUrl: "",
  });
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [descError, setDescError] = useState("");
  const blurTimeout = useRef(null);
  const imageInput = useRef(null);

  useEffect(() => {
    if (isEdit) {
      api.get("/vendor/products").then((res) => {
        const product = res.data.find((p) => String(p.id) === id);
        if (product) {
          setForm({
            name: product.name,
            description: product.description,
            category: product.category,
            price: product.price,
            stock: product.stock,
            imageUrl: product.image_url || "",
          });
        }
      });
    }
  }, [id, isEdit]);

  const handleNameChange = async (e) => {
    const value = e.target.value;
    setForm({ ...form, name: value });
    if (value.length > 0) {
      const { data } = await api.get("/vendor/products/suggestions", { params: { q: value } });
      setSuggestions(data);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleGenerateDescription = async () => {
    const name = form.name.trim();
    const category = form.category.trim();
    if (!name || !category) {
      setDescError("Enter a product name and category first, then generate a description.");
      return;
    }
    setDescError("");
    setGeneratingDesc(true);
    try {
      const res = await api.post("/ai/generate-description", { name, category });
      setForm((prev) => ({ ...prev, description: res.data.description }));
    } catch (err) {
      const msg = err.response?.data?.error || "AI is temporarily unavailable. You can write the description manually.";
      setDescError(msg);
    } finally {
      setGeneratingDesc(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isEdit) {
        await api.put(`/vendor/products/${id}`, form);
      } else {
        await api.post("/vendor/products", form);
      }
      window.dispatchEvent(new Event("inventory-updated"));
      navigate("/vendor/catalog");
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const uploadImage = async (file) => {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setUploadingImage(true);
    try {
      const imageData = await createProductImageData(file);
      setForm((current) => ({ ...current, imageUrl: imageData }));
    } catch {
      setError("Unable to prepare this image. Try another JPG, PNG, WebP, or GIF file.");
    } finally {
      setUploadingImage(false);
      setIsDraggingImage(false);
      if (imageInput.current) imageInput.current.value = "";
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto lg:h-full lg:flex lg:flex-col">
      <h1 className="font-display text-2xl font-bold mb-1">{isEdit ? "Edit product" : "Add new product"}</h1>
      <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
        Fill in the details below to {isEdit ? "update this listing" : "list a new product in your catalog"}.
      </p>


      {error && (
        <div className="mb-4 text-sm px-4 py-3 rounded-lg" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 rounded-2xl p-5 sm:p-6 lg:grid-cols-2 lg:gap-3 lg:p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="relative">
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink-soft)" }}>
            Product name <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            required
            value={form.name}
            onChange={handleNameChange}
            onFocus={() => form.name && setShowSuggestions(true)}
            onBlur={() => { blurTimeout.current = setTimeout(() => setShowSuggestions(false), 120); }}
            placeholder="e.g. Wireless Bluetooth Headphones"
            className="w-full px-4 py-2.5 rounded-lg text-sm focus-ring"
            style={{ border: "1px solid var(--border)" }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul
              className="absolute z-20 w-full mt-1 rounded-lg overflow-hidden text-sm shadow-xl"
              style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
            >
              {suggestions.map((s, idx) => {
                const name = typeof s === "object" ? s.name : s;
                const cat = typeof s === "object" ? s.category : "";
                const price = typeof s === "object" ? s.price : null;
                const origin = typeof s === "object" && s.origin === "dataset" ? "Dataset" : "";
                return (
                  <li
                    key={`${name}-${idx}`}
                    onMouseDown={() => {
                      if (typeof s === "object" && s !== null) {
                        setForm((prev) => ({
                          ...prev,
                          name: s.name || prev.name,
                          category: s.category || prev.category,
                          price: s.price != null ? String(s.price) : prev.price,
                          stock: s.stock != null ? String(s.stock) : prev.stock,
                          description: prev.description || `${s.name} - high quality ${s.category?.toLowerCase() || "item"} from catalog.`
                        }));
                      } else {
                        setForm((prev) => ({ ...prev, name: s }));
                      }
                      setShowSuggestions(false);
                    }}
                    className="px-4 py-2.5 cursor-pointer text-white hover:bg-white/10 flex items-center justify-between transition-colors border-b border-white/5 last:border-0"
                  >
                    <div>
                      <div className="font-medium text-white">{name}</div>
                      {cat && <div className="text-xs text-white/60">{cat} {price ? `· ₹${price}` : ""}</div>}
                    </div>
                    {origin && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold uppercase">
                        {origin}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>
              Description <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <button
              type="button"
              onClick={handleGenerateDescription}
              disabled={generatingDesc || !form.name.trim() || !form.category.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
              style={{ background: "var(--primary)", color: "white" }}
              title={!form.name.trim() || !form.category.trim() ? "Enter a product name and category first" : "Generate a professional description with AI"}
            >
              {generatingDesc ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles size={12} />
                  Generate with AI
                </>
              )}
            </button>
          </div>
          <textarea
            required
            rows={3}
            value={form.description}
            onChange={(e) => { setForm({ ...form, description: e.target.value }); setDescError(""); }}
            placeholder="Describe your product, or click Generate with AI after entering a name and category…"
            className="w-full px-4 py-2.5 rounded-lg text-sm focus-ring resize-none"
            style={{ border: "1px solid var(--border)" }}
          />
          {descError && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs" style={{ color: "var(--danger)" }}>
              <AlertCircle size={12} />
              {descError}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink-soft)" }}>
            Category <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            type="text"
            required
            value={form.category}
            onChange={(e) => {
              const value = e.target.value;
              setForm({ ...form, category: value === "Other" ? "" : value });
            }}
            list="product-categories"
            placeholder="Choose a category or type your own"
            className="w-full px-4 py-2.5 rounded-lg text-sm focus-ring"
            style={{ border: "1px solid var(--border)" }}
          />
          <datalist id="product-categories">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </datalist>
          <p className="mt-1.5 text-xs" style={{ color: "var(--ink-soft)" }}>
            Select Other to type a custom category in this same field.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink-soft)" }}>
              Price (INR) <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              required
              type="number"
              step="0.01"
              min="0"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="0.00"
              className="w-full px-4 py-2.5 rounded-lg text-sm focus-ring"
              style={{ border: "1px solid var(--border)" }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink-soft)" }}>
              Stock quantity
            </label>
            <input
              type="number"
              min="0"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
              placeholder="0"
              className="w-full px-4 py-2.5 rounded-lg text-sm focus-ring"
              style={{ border: "1px solid var(--border)" }}
            />
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>Product image <span className="normal-case font-normal">(optional)</span></label>
            {form.imageUrl && <span className="text-xs font-medium" style={{ color: "var(--success)" }}>Image ready</span>}
          </div>
          <div
            className="rounded-xl border-2 border-dashed p-2.5 sm:p-3 transition"
            style={{ borderColor: isDraggingImage ? "var(--primary)" : "var(--border)", background: isDraggingImage ? "var(--success-soft)" : "var(--surface)" }}
            onDragEnter={(event) => { event.preventDefault(); setIsDraggingImage(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDraggingImage(false)}
            onDrop={(event) => { event.preventDefault(); uploadImage(event.dataTransfer.files[0]); }}
          >
            <div className="flex items-center gap-3 text-left">
              <div className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: "var(--card)", color: "var(--primary)", border: "1px solid var(--border)" }}>
                {form.imageUrl ? <ProductImage src={form.imageUrl} alt="Product preview" /> : <ImageUp size={21} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Drop a photo here</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--ink-soft)" }}>JPG, PNG, WebP, or GIF · up to 5 MB</p>
              </div>
            <input ref={imageInput} type="file" accept="image/*" className="hidden" onChange={(event) => uploadImage(event.target.files[0])} />
            <button type="button" onClick={() => imageInput.current?.click()} disabled={uploadingImage} className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold focus-ring disabled:opacity-60" style={{ background: "var(--primary)", color: "white" }}>
              {uploadingImage ? "Uploading…" : "Choose image"}
            </button>
            </div>
          </div>
          <div className="mt-2">
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--primary)" }}>Or paste a direct image link</label>
            <input
              type="url"
              value={form.imageUrl.startsWith("data:") ? "" : form.imageUrl}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              placeholder="https://example.com/product-image.jpg"
              className="w-full px-3.5 py-2 rounded-lg text-sm focus-ring"
              style={{ border: "1px solid var(--border)", background: "var(--card)" }}
            />
          </div>
        </div>


        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60 focus-ring lg:col-span-2"
          style={{ background: "var(--primary)" }}
        >
          {loading ? "Saving…" : isEdit ? "Save changes" : "Add to catalog"}
        </button>
      </form>
    </div>
  );
}
