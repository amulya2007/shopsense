import { NavLink, useNavigate } from "react-router-dom";
import { PackageSearch, LogOut } from "lucide-react";
import { useAuth } from "../context/auth";
import InventoryNotifications from "./InventoryNotifications";

export default function Shell({ navItems, roleLabel, children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="h-screen overflow-hidden flex" style={{ background: "var(--surface)" }}>
      <aside
        className="h-full w-16 shrink-0 flex flex-col justify-between px-2 py-4 sm:w-20 sm:px-3 lg:w-60 lg:px-4 lg:py-6"
        style={{ background: "var(--sidebar)" }}
      >
        <div>
          <div className="mb-6 flex items-center justify-center gap-2 px-2 lg:mb-8 lg:justify-start">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
              <PackageSearch size={17} color="#0d1e1a" />
            </div>
            <span className="hidden font-display text-lg font-bold text-white lg:inline">ShopSense</span>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={() =>
                  `flex items-center justify-center gap-3 px-2 py-2.5 text-sm font-medium transition relative lg:justify-start lg:px-3`
                }
                style={({ isActive }) => ({
                  color: isActive ? "white" : "var(--sidebar-soft)",
                  background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                  borderLeft: isActive ? "3px solid var(--accent)" : "3px solid transparent",
                })}
              >
                <item.icon size={16} />
                <span className="hidden lg:inline">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-2 px-2 py-2.5 text-sm font-medium focus-ring lg:justify-start lg:px-3"
          style={{ color: "var(--sidebar-soft)" }}
        >
          <LogOut size={16} /> <span className="hidden lg:inline">Sign out</span>
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="flex items-center justify-end gap-2 px-3 py-3 sm:gap-3 sm:px-5 lg:px-8 lg:py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          {roleLabel === "Vendor" && <InventoryNotifications />}
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
            style={{ background: "var(--accent-soft)", color: "#7a5719" }}
          >
            {roleLabel}
          </span>
          <div className="hidden min-w-0 text-right leading-tight sm:block">
            <div className="text-sm font-semibold">{user?.name}</div>
            <div className="text-xs" style={{ color: "var(--ink-soft)" }}>
              {user?.businessName || user?.email}
            </div>
          </div>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ background: "var(--primary)" }}
          >
            {user?.name?.[0]?.toUpperCase() || "?"}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
