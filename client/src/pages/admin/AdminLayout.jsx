import { Outlet } from "react-router-dom";
import { LayoutGrid, Users } from "lucide-react";
import Shell from "../../components/Shell";

const navItems = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/admin/vendors", label: "Vendor management", icon: Users },
];

export default function AdminLayout() {
  return (
    <Shell navItems={navItems} roleLabel="Admin">
      <Outlet />
    </Shell>
  );
}
