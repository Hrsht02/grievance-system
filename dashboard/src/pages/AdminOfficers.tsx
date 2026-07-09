import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Layout from "../components/Layout";
import api from "../api";

const NAV = [
  { label: "Overview", path: "/admin" },
  { label: "Escalations", path: "/admin/escalations" },
  { label: "Officers", path: "/admin/officers" },
  { label: "Hospitals", path: "/admin/hospitals" },
];

interface Officer {
  id: string; name: string; email: string; assigned_district: string;
  is_active: boolean; created_at: string;
  total_complaints: number; acked: number; resolved: number; sla_breaches: number;
}

export default function AdminOfficers() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", assigned_district: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function load() { api.get("/admin/officers").then((r) => setOfficers(r.data)); }
  useEffect(() => { load(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api.post("/admin/officers", form);
      setShowForm(false);
      setForm({ name: "", email: "", password: "", assigned_district: "" });
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to create officer.");
    } finally { setLoading(false); }
  }

  async function deactivate(id: string) {
    if (!confirm("Deactivate this officer? They will lose dashboard access.")) return;
    await api.patch(`/admin/officers/${id}/deactivate`);
    load();
  }

  const problematic = officers.filter(o => o.is_active && o.sla_breaches > 2);

  return (
    <Layout nav={NAV}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>Officers</h1>
          <p style={{ fontSize: 13, color: "#6b7280" }}>{officers.filter(o => o.is_active).length} active officers</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}
          style={{ borderRadius: 8 }}>
          {showForm ? "Cancel" : "+ Add Officer"}
        </button>
      </div>

      {/* Problematic officers alert */}
      {problematic.length > 0 && (
        <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
          <p style={{ fontWeight: 700, color: "#be123c", marginBottom: 8 }}>⚠️ Officers with performance issues ({problematic.length})</p>
          {problematic.map(o => (
            <div key={o.id} style={{ fontSize: 13, color: "#9f1239", marginBottom: 4 }}>
              • <strong>{o.name}</strong> — {o.sla_breaches} SLA breaches, {o.total_complaints - o.resolved} unresolved complaints
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginBottom: 20, borderTop: "3px solid #1d4ed8" }}>
          <h3 style={{ fontWeight: 700, marginBottom: 16, fontSize: 15 }}>Create Officer Account</h3>
          <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Full Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" required />
            <Field label="Password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" required />
            <Field label="Assigned District" value={form.assigned_district} onChange={(v) => setForm({ ...form, assigned_district: v })} required />
            {error && <p style={{ color: "#dc2626", gridColumn: "1/-1", fontSize: 13 }}>{error}</p>}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ gridColumn: "1/-1", borderRadius: 8 }}>
              {loading ? "Creating…" : "Create Officer"}
            </button>
          </form>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {officers.map((o) => {
          const ackRate = o.total_complaints > 0 ? Math.round((o.acked / o.total_complaints) * 100) : 0;
          const resRate = o.total_complaints > 0 ? Math.round((o.resolved / o.total_complaints) * 100) : 0;
          const isProblematic = o.is_active && o.sla_breaches > 2;

          return (
            <div key={o.id} style={{
              background: "white", borderRadius: 12, padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              opacity: o.is_active ? 1 : 0.5,
              borderLeft: `4px solid ${isProblematic ? "#dc2626" : o.is_active ? "#1d4ed8" : "#d1d5db"}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{o.name}</span>
                    {!o.is_active && <span style={{ fontSize: 11, background: "#f3f4f6", color: "#6b7280", padding: "2px 8px", borderRadius: 20 }}>Inactive</span>}
                    {isProblematic && <span style={{ fontSize: 11, background: "#fee2e2", color: "#dc2626", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>⚠️ {o.sla_breaches} breaches</span>}
                  </div>
                  <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>{o.email} · District: <strong>{o.assigned_district}</strong></p>

                  {/* Performance metrics */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                    <Metric label="Total" value={o.total_complaints} />
                    <Metric label="Ack Rate" value={`${ackRate}%`} color={ackRate >= 80 ? "#059669" : "#d97706"} />
                    <Metric label="Res Rate" value={`${resRate}%`} color={resRate >= 70 ? "#059669" : "#d97706"} />
                    <Metric label="Breaches" value={o.sla_breaches} color={o.sla_breaches > 2 ? "#dc2626" : o.sla_breaches > 0 ? "#d97706" : "#059669"} />
                  </div>
                </div>
                {o.is_active && (
                  <button onClick={() => deactivate(o.id)}
                    style={{ marginLeft: 12, padding: "6px 14px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}

function Field({ label, value, onChange, type = "text", required = false }:
  { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: 12, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required}
        style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14 }} />
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: color ?? "#111827" }}>{value}</div>
      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
    </div>
  );
}
