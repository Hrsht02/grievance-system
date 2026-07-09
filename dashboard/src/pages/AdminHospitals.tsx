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

interface Hospital {
  id: string; name: string; district: string; state: string;
  phone_number?: string; address?: string; email?: string;
  complaint_count?: number; officer_name?: string;
}

export default function AdminHospitals() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", district: "", phone_number: "", address: "", email: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function load() { api.get("/admin/hospitals").then((r) => setHospitals(r.data)); }
  useEffect(() => { load(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api.post("/admin/hospitals", form);
      setShowForm(false);
      setForm({ name: "", district: "", phone_number: "", address: "", email: "" });
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to create hospital.");
    } finally { setLoading(false); }
  }

  const problematic = hospitals.filter(h => (h.complaint_count ?? 0) > 5);

  return (
    <Layout nav={NAV}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>Hospitals</h1>
          <p style={{ fontSize: 13, color: "#6b7280" }}>{hospitals.length} registered hospitals</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)} style={{ borderRadius: 8 }}>
          {showForm ? "Cancel" : "+ Add Hospital"}
        </button>
      </div>

      {/* High complaint hospitals */}
      {problematic.length > 0 && (
        <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
          <p style={{ fontWeight: 700, color: "#be123c", marginBottom: 8 }}>⚠️ Hospitals with high complaint volume</p>
          {problematic.map(h => (
            <div key={h.id} style={{ fontSize: 13, color: "#9f1239", marginBottom: 4 }}>
              • <strong>{h.name}</strong> ({h.district}) — {h.complaint_count} complaints
              {h.officer_name ? ` · Officer: ${h.officer_name}` : " · No officer assigned"}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginBottom: 20, borderTop: "3px solid #1d4ed8" }}>
          <h3 style={{ fontWeight: 700, marginBottom: 16, fontSize: 15 }}>Add Hospital</h3>
          <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Hospital Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Field label="District *" value={form.district} onChange={(v) => setForm({ ...form, district: v })} required />
            <Field label="Phone Number" value={form.phone_number} onChange={(v) => setForm({ ...form, phone_number: v })} type="tel" />
            <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
            <div style={{ gridColumn: "1/-1" }}>
              <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            </div>
            {error && <p style={{ color: "#dc2626", gridColumn: "1/-1", fontSize: 13 }}>{error}</p>}
            <p style={{ gridColumn: "1/-1", fontSize: 12, color: "#6b7280" }}>
              ℹ️ An officer assigned to the same district will automatically handle complaints from this hospital.
            </p>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ gridColumn: "1/-1", borderRadius: 8 }}>
              {loading ? "Adding…" : "Add Hospital"}
            </button>
          </form>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {hospitals.map((h) => {
          const isHigh = (h.complaint_count ?? 0) > 5;
          return (
            <div key={h.id} style={{
              background: "white", borderRadius: 12, padding: "16px 18px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              borderTop: `3px solid ${isHigh ? "#dc2626" : "#1d4ed8"}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 15, color: "#111827", marginBottom: 2 }}>{h.name}</p>
                  <p style={{ fontSize: 12, color: "#6b7280" }}>📍 {h.district}, {h.state ?? "Bihar"}</p>
                </div>
                {h.complaint_count !== undefined && (
                  <div style={{ textAlign: "center", background: isHigh ? "#fee2e2" : "#eff6ff", padding: "6px 12px", borderRadius: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: 18, color: isHigh ? "#dc2626" : "#1d4ed8" }}>{h.complaint_count}</div>
                    <div style={{ fontSize: 10, color: "#6b7280" }}>complaints</div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {h.phone_number && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "#374151" }}>📞 {h.phone_number}</span>
                    <a href={`tel:${h.phone_number}`} style={{
                      fontSize: 11, padding: "2px 10px", background: "#dcfce7", color: "#065f46",
                      borderRadius: 20, textDecoration: "none", fontWeight: 600
                    }}>Call</a>
                  </div>
                )}
                {h.email && <p style={{ fontSize: 12, color: "#6b7280" }}>✉️ {h.email}</p>}
                {h.address && <p style={{ fontSize: 12, color: "#6b7280" }}>🗺 {h.address}</p>}
                {h.officer_name && (
                  <p style={{ fontSize: 12, marginTop: 4, color: "#1d4ed8" }}>👮 Officer: {h.officer_name}</p>
                )}
                {!h.officer_name && (
                  <p style={{ fontSize: 12, marginTop: 4, color: "#dc2626" }}>⚠️ No officer assigned</p>
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
