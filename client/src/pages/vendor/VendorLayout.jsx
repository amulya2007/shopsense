import { Outlet } from "react-router-dom";
import { LayoutGrid, Package, PlusCircle, Lightbulb, Bot, UserCircle } from "lucide-react";
import Shell from "../../components/Shell";

const navItems = [
  { to: "/vendor/dashboard", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/vendor/catalog", label: "My catalog", icon: Package },
  { to: "/vendor/add-product", label: "Add product", icon: PlusCircle },
  { to: "/vendor/insights", label: "Insights", icon: Lightbulb },
  { to: "/vendor/assistant", label: "AI Assistant", icon: Bot },
  { to: "/vendor/profile", label: "Profile", icon: UserCircle },
];

export default function VendorLayout() {
  return (
    <Shell navItems={navItems} roleLabel="Vendor">
      <Outlet />
    </Shell>
  );
}
