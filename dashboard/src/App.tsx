import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import OfficerDashboard from "./pages/OfficerDashboard";
import ComplaintDetail from "./pages/ComplaintDetail";
import AdminDashboard from "./pages/AdminDashboard";
import AdminEscalations from "./pages/AdminEscalations";
import AdminOfficers from "./pages/AdminOfficers";

function RequireAuth({ children, role }: { children: JSX.Element; role?: string }) {
  const token = localStorage.getItem("token");
  const userRole = localStorage.getItem("role");
  if (!token) return <Navigate to="/login" replace />;
  if (role && userRole !== role) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Officer routes */}
      <Route
        path="/officer"
        element={<RequireAuth role="officer"><OfficerDashboard /></RequireAuth>}
      />
      <Route
        path="/officer/complaints/:id"
        element={<RequireAuth role="officer"><ComplaintDetail /></RequireAuth>}
      />

      {/* Superadmin routes */}
      <Route
        path="/admin"
        element={<RequireAuth role="superadmin"><AdminDashboard /></RequireAuth>}
      />
      <Route
        path="/admin/escalations"
        element={<RequireAuth role="superadmin"><AdminEscalations /></RequireAuth>}
      />
      <Route
        path="/admin/officers"
        element={<RequireAuth role="superadmin"><AdminOfficers /></RequireAuth>}
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
