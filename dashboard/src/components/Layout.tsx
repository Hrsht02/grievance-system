import { ReactNode } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";

interface NavItem { label: string; path: string }

export default function Layout({ children, nav }: { children: ReactNode; nav: NavItem[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const role = localStorage.getItem("role");

  function logout() {
    localStorage.clear();
    navigate("/login");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, background: "#1e3a5f", color: "white",
        display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0,
      }}>
        <div style={{ padding: "0 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Bihar Grievance</div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2, textTransform: "capitalize" }}>
            {role === "superadmin" ? "Superadmin" : "Officer"}
          </div>
        </div>
        <nav style={{ flex: 1, padding: "16px 0" }}>
          {nav.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              style={{
                display: "block", padding: "10px 20px", fontSize: 14,
                background: location.pathname.startsWith(item.path) ? "rgba(255,255,255,0.12)" : "transparent",
                color: "white", borderLeft: location.pathname.startsWith(item.path) ? "3px solid #60a5fa" : "3px solid transparent",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={logout}
          style={{ margin: "0 16px 16px", padding: "8px", background: "rgba(255,255,255,0.1)",
                   border: "none", color: "white", borderRadius: 6, cursor: "pointer" }}
        >
          Sign Out
        </button>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: 28, overflowY: "auto" }}>
        {children}
      </main>
    </div>
  );
}
