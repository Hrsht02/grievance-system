import { useEffect, useState, FormEvent } from "react";
import Layout from "../components/Layout";
import api from "../api";

const NAV = [
  { label: "Overview", path: "/admin" },
  { label: "Escalations", path: "/admin/escalations" },
  { label: "Officers", path: "/admin/officers" },
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

  function load() {
    api.get("/admin/officers").then((r) => setOfficers(r.data));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/admin/officers", form);
      setShowForm(false);
      setForm({ name: "", email: "", password: "", assigned_district: "" });
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to create officer.");
    } finally {
      setLoading(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm("Deactivate this officer? They will lose dashboard access.")) return;
    await api.patch(`/admin/officers/${id}/deactivate`);
    load();
  }

  return (
    <Layout nav={NAV}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Officers ({officers.length})</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New Officer"}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ fontWeight: 700, marginBottom: 14 }}>Create Officer Account</h3>
          <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Full Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" required />
            <Field label="Password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" required />
            <Field label="Assigned District" value={form.assigned_district} onChange={(v) => setForm({ ...form, assigned_district: v })} required />
            {error && <p style={{ color: "#dc2626", gridColumn: "1/-1" }}>{error}</p>}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ gridColumn: "1/-1" }}>
              {loading ? "Creating…" : "Create Officer"}
            </button>
          </form>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {officers.map((o) => (
          <div key={o.id} className="card" style={{ opacity: o.is_active ? 1 : 0.55 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>{o.name}</span>
                  {!o.is_active && <span className="badge" style={{ background: "#f3f4f6", color: "#6b7280" }}>Inactive</span>}
                  {o.sla_breaches > 2 && (
                    <span className="badge badge-critical">⚠️ {o.sla_breaches} breaches</span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: "#6b7280" }}>{o.email} · District: {o.assigned_district}</p>
                <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13 }}>
                  <Stat label="Total" value={o.total_complaints} />
                  <Stat label="Acknowledged" value={o.acked} />
                  <Stat label="Resolved" value={o.resolved} />
                  <Stat label="SLA Breaches" value={o.sla_breaches} color={o.sla_breaches > 0 ? "#dc2626" : undefined} />
                </div>
              </div>
              {o.is_active && (
                <button className="btn btn-danger" onClick={() => deactivate(o.id)} style={{ fontSize: 12, padding: "6px 12px" }}>
                  Deactivate
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}

function Field({
  label, value, onChange, type = "text", required = false
}: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
      />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <span style={{ color: "#9ca3af" }}>{label}: </span>
      <span style={{ fontWeight: 700, color: color ?? "#1a1a2e" }}>{value}</span>
    </div>
  );
}
