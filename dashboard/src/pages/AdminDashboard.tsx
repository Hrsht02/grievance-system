import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import api from "../api";

const NAV = [
  { label: "Overview", path: "/admin" },
  { label: "Escalations", path: "/admin/escalations" },
  { label: "Officers", path: "/admin/officers" },
];

interface Stats {
  totals: { total: number; pending: number; resolved: number; avg_resolution_hours: number | null };
  by_category: { category: string; count: number }[];
  by_hospital: { hospital: string; count: number }[];
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get("/admin/stats").then((r) => setStats(r.data));
  }, []);

  if (!stats) return <Layout nav={NAV}><p>Loading…</p></Layout>;

  const t = stats.totals;

  return (
    <Layout nav={NAV}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>State Overview</h1>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        <KpiCard label="Total Complaints" value={t.total} color="#1d4ed8" />
        <KpiCard label="Pending" value={t.pending} color="#d97706" />
        <KpiCard label="Resolved" value={t.resolved} color="#059669" />
        <KpiCard
          label="Avg Resolution Time"
          value={t.avg_resolution_hours != null ? `${t.avg_resolution_hours.toFixed(1)} hrs` : "—"}
          color="#6b7280"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* By category */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>Top Complaint Categories</h3>
          {stats.by_category.slice(0, 10).map((row) => (
            <BarRow
              key={row.category}
              label={row.category?.replace(/_/g, " ") ?? "uncategorized"}
              value={row.count}
              max={stats.by_category[0]?.count ?? 1}
            />
          ))}
        </div>

        {/* By hospital */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>Complaints by Hospital</h3>
          {stats.by_hospital.map((row) => (
            <BarRow
              key={row.hospital}
              label={row.hospital}
              value={row.count}
              max={stats.by_hospital[0]?.count ?? 1}
            />
          ))}
        </div>
      </div>
    </Layout>
  );
}

function KpiCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="card" style={{ borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
        <span style={{ textTransform: "capitalize" }}>{label}</span>
        <span style={{ fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 6, background: "#f3f4f6", borderRadius: 3 }}>
        <div style={{ height: 6, width: `${pct}%`, background: "#1d4ed8", borderRadius: 3 }} />
      </div>
    </div>
  );
}
