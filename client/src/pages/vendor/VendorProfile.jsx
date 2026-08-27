import { useEffect, useState } from "react";
import api from "../../lib/api";
import StatusBadge from "../../components/StatusBadge";
import { useAuth } from "../../context/auth";

export default function VendorProfile() {
  const { updateUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ fullName: "", businessName: "", phone: "", businessAddress: "", password: "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/vendor/profile").then((res) => {
      setProfile(res.data);
      setForm({
        fullName: res.data.full_name,
        businessName: res.data.business_name,
        phone: res.data.phone || "",
        businessAddress: res.data.business_address || "",
        password: "",
      });
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      const { data } = await api.put("/vendor/profile", form);
      const updatedProfile = data.vendor || { ...profile, full_name: form.fullName, business_name: form.businessName, phone: form.phone, business_address: form.businessAddress };
      setProfile(updatedProfile);
      setForm((current) => ({ ...current, password: "" }));
      updateUser({ name: updatedProfile.full_name, businessName: updatedProfile.business_name, email: updatedProfile.email });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong.");
    }
  };

  if (!profile) return null;

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-xl font-bold mb-1">Profile</h1>
      <p className="text-sm mb-6" style={{ color: "var(--ink-soft)" }}>Account information</p>

      {saved && (
        <div className="mb-4 text-sm px-4 py-3 rounded-lg" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
          Profile updated.
        </div>
      )}
      {error && (
        <div className="mb-4 text-sm px-4 py-3 rounded-lg" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <Field label="Full name" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} />
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink-soft)" }}>Email address</label>
          <input disabled value={profile.email} className="w-full px-4 py-2.5 rounded-lg text-sm opacity-60" style={{ border: "1px solid var(--border)" }} />
          <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>Email address cannot be changed.</p>
        </div>
        <Field label="Business name" value={form.businessName} onChange={(v) => setForm({ ...form, businessName: v })} />
        <Field label="Phone number" optional value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="Not provided" />
        <Field label="Business address" optional value={form.businessAddress} onChange={(v) => setForm({ ...form, businessAddress: v })} placeholder="Not provided" />
        <Field label="New password" optional type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="Leave blank to keep current password" />

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink-soft)" }}>Account status</div>
          <StatusBadge status={profile.status} />
        </div>

        <button
          type="submit"
          className="w-full py-2.5 rounded-lg text-sm font-semibold text-white focus-ring"
          style={{ background: "var(--primary)" }}
        >
          Save changes
        </button>
      </form>
    </div>
  );
}

function Field({ label, optional, type = "text", value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink-soft)" }}>
        {label} {optional && <span className="normal-case font-normal">(optional)</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 rounded-lg text-sm focus-ring"
        style={{ border: "1px solid var(--border)" }}
      />
    </div>
  );
}
