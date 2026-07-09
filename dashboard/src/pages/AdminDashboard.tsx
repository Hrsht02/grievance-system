import { useEffect, useState, useRef, useCallback } from "react";
import Layout from "../components/Layout";
import api from "../api";

const NAV = [
  { label: "Overview", path: "/admin" },
  { label: "Escalations", path: "/admin/escalations" },
  { label: "Officers", path: "/admin/officers" },
  { label: "Hospitals", path: "/admin/hospitals" },
];

interface Stats {
  totals: { total: number; pending: number; resolved: number; avg_resolution_hours: number | null };
  by_category: { category: string; count: number }[];
  by_hospital: { hospital: string; count: number }[];
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const prevTotal = useRef(0);
  const firstLoad = useRef(true);

  const load = useCallback(() => {
    api.get("/admin/stats").then((r) => {
      const s: Stats = r.data;
      const newTotal = s.totals.total;
      if (!firstLoad.current && newTotal > prevTotal.current) {
        const diff = newTotal - prevTotal.current;
        setNotification(`🔔 ${diff} new complaint${diff > 1 ? "s" : ""} filed across hospitals`);
        setTimeout(() => setNotification(null), 6000);
        if (Notification.permission === "granted") {
          new Notification("Bihar Grievance — Superadmin", {
            body: `${diff} new complaint${diff > 1 ? "s" : ""} filed`
          });
        }
      }
      prevTotal.current = newTotal;
      firstLoad.current = false;
      setStats(s);
    });
  }, []);

  useEffect(() => {
    load();
    if (Notification.permission === "default") Notification.requestPermission();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  if (!stats) return (
    <Layout nav={NAV}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
        <p style={{ color: "#9ca3af" }}>Loading…</p>
      </div>
    </Layout>
  );

  const t = stats.totals;
  const resolutionRate = t.total > 0 ? Math.round((t.resolved / t.total) * 100) : 0;

  return (
    <Layout nav={NAV}>
      {notification && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: "#1d4ed8", color: "white", padding: "14px 20px",
          borderRadius: 12, boxShadow: "0 8px 24px rgba(29,78,216,0.4)",
          fontSize: 14, fontWeight: 600, animation: "slideDown 0.3s ease",
        }}>
          <style>{`@keyframes slideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
          {notification}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>State Overview</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Bihar Government Hospital Grievance System — Live Dashboard</p>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        <KpiCard label="Total Complaints" value={t.total} color="#1d4ed8" icon="📋" />
        <KpiCard label="Pending Action" value={t.pending} color="#d97706" icon="⏳" />
        <KpiCard label="Resolved" value={t.resolved} color="#059669" icon="✅" />
        <KpiCard
          label="Avg Resolution"
          value={t.avg_resolution_hours != null ? `${t.avg_resolution_hours.toFixed(1)}h` : "—"}
          color="#7c3aed" icon="⚡"
        />
      </div>

      {/* Resolution rate bar */}
      <div className="card" style={{ marginBottom: 20, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Overall Resolution Rate</span>
          <span style={{ fontWeight: 800, fontSize: 18, color: resolutionRate >= 70 ? "#059669" : resolutionRate >= 40 ? "#d97706" : "#dc2626" }}>
            {resolutionRate}%
          </span>
        </div>
        <div style={{ height: 10, background: "#f3f4f6", borderRadius: 5 }}>
          <div style={{
            height: 10, borderRadius: 5, transition: "width 0.8s ease",
            width: `${resolutionRate}%`,
            background: resolutionRate >= 70 ? "#059669" : resolutionRate >= 40 ? "#d97706" : "#dc2626",
          }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* By category */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: 16, fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, color: "#374151" }}>
            📊 Top Complaint Categories
          </h3>
          {stats.by_category.length === 0 && <p style={{ color: "#9ca3af", fontSize: 13 }}>No data yet.</p>}
          {stats.by_category.slice(0, 8).map((row, i) => (
            <BarRow
              key={row.category}
              label={row.category?.replace(/_/g, " ") ?? "uncategorized"}
              value={row.count}
              max={stats.by_category[0]?.count ?? 1}
              rank={i}
            />
          ))}
        </div>

        {/* By hospital */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: 16, fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, color: "#374151" }}>
            🏥 Complaints by Hospital
          </h3>
          {stats.by_hospital.length === 0 && <p style={{ color: "#9ca3af", fontSize: 13 }}>No data yet.</p>}
          {stats.by_hospital.map((row, i) => (
            <BarRow
              key={row.hospital}
              label={row.hospital}
              value={row.count}
              max={stats.by_hospital[0]?.count ?? 1}
              rank={i}
              warn={i === 0 && stats.by_hospital.length > 1}
            />
          ))}
        </div>
      </div>
    </Layout>
  );
}

function KpiCard({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: string }) {
  return (
    <div style={{
      background: "white", borderRadius: 12, padding: "18px 20px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      borderTop: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: 28, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

function BarRow({ label, value, max, rank, warn }: {
  label: string; value: number; max: number; rank: number; warn?: boolean;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const barColor = warn ? "#dc2626" : rank === 0 ? "#1d4ed8" : rank === 1 ? "#3b82f6" : "#93c5fd";
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4, alignItems: "center" }}>
        <span style={{ textTransform: "capitalize", color: warn ? "#dc2626" : "#374151", fontWeight: warn ? 700 : 400 }}>
          {warn && "⚠️ "}{label}
        </span>
        <span style={{ fontWeight: 700, color: warn ? "#dc2626" : "#374151" }}>{value}</span>
      </div>
      <div style={{ height: 7, background: "#f3f4f6", borderRadius: 4 }}>
        <div style={{ height: 7, width: `${pct}%`, background: barColor, borderRadius: 4, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}
