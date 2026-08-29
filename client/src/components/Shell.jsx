import { NavLink, useNavigate } from "react-router-dom";
import { PackageSearch, LogOut, ChevronLeft, ChevronRight, Bell } from "lucide-react";
import { useAuth } from "../context/auth";
import { useState } from "react";
import InventoryNotifications from "./InventoryNotifications";

export default function Shell({ navItems, roleLabel, children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="h-screen overflow-hidden flex" style={{ background: "var(--surface)" }}>
      {/* Sidebar */}
      <aside
        className={`h-full shrink-0 flex flex-col justify-between py-4 transition-all duration-300 ${
          sidebarCollapsed ? "w-16" : "w-16 sm:w-20 lg:w-64"
        }`}
        style={{ background: "var(--sidebar)" }}
      >
        <div>
          {/* Logo */}
          <div className="mb-6 flex items-center justify-center gap-2 px-2 lg:mb-8">
            <div 
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" 
              style={{ background: "var(--accent)" }}
            >
              <PackageSearch size={18} color="#0d1e1a" />
            </div>
            {!sidebarCollapsed && (
              <span className="hidden font-display text-lg font-bold text-white lg:inline">
                ShopSense
              </span>
            )}
          </div>

          {/* Navigation */}
          <nav className="space-y-1 px-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="group flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-all rounded-lg relative"
                style={({ isActive }) => ({
                  color: isActive ? "white" : "var(--sidebar-soft)",
                  background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                })}
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <div 
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
                        style={{ background: "var(--accent)" }}
                      />
                    )}
                    <item.icon size={18} className="shrink-0" />
                    {!sidebarCollapsed && (
                      <span className="hidden lg:inline truncate">{item.label}</span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Bottom Section */}
        <div className="px-2 space-y-2">
          {/* Collapse Toggle - Desktop Only */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex items-center justify-center gap-2 w-full px-3 py-2.5 text-sm font-medium focus-ring rounded-lg transition-all hover:bg-white/5"
            style={{ color: "var(--sidebar-soft)" }}
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!sidebarCollapsed && <span>Collapse</span>}
          </button>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full px-3 py-2.5 text-sm font-medium focus-ring rounded-lg transition-all hover:bg-white/5"
            style={{ color: "var(--sidebar-soft)" }}
          >
            <LogOut size={18} />
            {!sidebarCollapsed && <span className="hidden lg:inline">Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header
          className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:py-4"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}
        >
          {/* Left Side - Could add breadcrumbs here */}
          <div className="flex-1 min-w-0">
            {/* Placeholder for breadcrumbs or search */}
          </div>

          {/* Right Side - Notifications and User */}
          <div className="flex items-center gap-3">
            {roleLabel === "Vendor" && <InventoryNotifications />}
            
            {/* Role Badge */}
            <span
              className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md"
              style={{ background: "var(--accent-soft)", color: "#7a5719" }}
            >
              {roleLabel}
            </span>

            {/* User Info */}
            <div className="hidden md:block min-w-0 text-right leading-tight">
              <div className="text-sm font-semibold truncate">{user?.name}</div>
              <div className="text-xs truncate" style={{ color: "var(--ink-soft)" }}>
                {user?.businessName || user?.email}
              </div>
            </div>

            {/* User Avatar */}
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ background: "var(--primary)" }}
            >
              {user?.name?.[0]?.toUpperCase() || "?"}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
