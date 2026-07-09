import { useEffect, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import Layout from "../components/Layout";
import api from "../api";

const NAV = [
  { label: "Overview", path: "/admin" },
  { label: "Escalations", path: "/admin/escalations" },
  { label: "Officers", path: "/admin/officers" },
  { label: "Hospitals", path: "/admin/hospitals" },
];

interface Escalation {
  id: string; reason: string; escalated_to_role: string; created_at: string;
  complaint_code: string; urgency: string; category: string;
  summary_en: string; raw_text: string; complaint_status: string;
  patient_name: string; hospital_name: string;
  officer_name: string | null; officer_email: string | null;
  officer_total_breaches: number;
  officer_phone?: string;
}

const REASON_LABELS: Record<string, string> = {
  ack_sla_breach: "Acknowledgment SLA Breach",
  resolution_sla_breach: "Resolution SLA Breach",
  patient_reopened: "Patient Rejected Resolution",
};

const REASON_COLORS: Record<string, string> = {
  ack_sla_breach: "#dc2626",
  resolution_sla_breach: "#d97706",
  patient_reopened: "#7c3aed",
};

export default function AdminEscalations() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [calling, setCalling] = useState<Escalation | null>(null);
  const [callSecs, setCallSecs] = useState(0);

  useEffect(() => {
    api.get("/admin/escalations").then((r) => setItems(r.data));
  }, []);

  useEffect(() => {
    if (!calling) { setCallSecs(0); return; }
    const t = setInterval(() => setCallSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [calling]);

  function fmt(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  return (
    <Layout nav={NAV}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>Escalations</h1>
        <p style={{ fontSize: 13, color: "#6b7280" }}>{items.length} total escalations requiring attention</p>
      </div>

      {items.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <p style={{ fontWeight: 600, fontSize: 16 }}>No escalations</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>All complaints are being handled on time.</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((e) => {
          const reasonColor = REASON_COLORS[e.reason] ?? "#6b7280";
          return (
            <div key={e.id} style={{
              background: "white", borderRadius: 12, padding: "16px 18px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              borderLeft: `5px solid ${e.urgency === "critical" ? "#dc2626" : "#f59e0b"}`,
              cursor: "pointer",
            }} onClick={() => setExpanded(expanded === e.id ? null : e.id)}>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{e.complaint_code}</span>
                    <span style={{
                      fontSize: 11, padding: "2px 10px", borderRadius: 20, fontWeight: 700, textTransform: "uppercase",
                      background: e.urgency === "critical" ? "#fff1f2" : "#fffbeb",
                      color: e.urgency === "critical" ? "#be123c" : "#92400e",
                    }}>{e.urgency}</span>
                    <span style={{ fontSize: 11, color: reasonColor, background: `${reasonColor}18`, padding: "2px 10px", borderRadius: 20, fontWeight: 600 }}>
                      {REASON_LABELS[e.reason] ?? e.reason}
                    </span>
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "#111827", marginBottom: 4 }}>{e.summary_en || e.raw_text?.slice(0, 100)}</p>
                  <p style={{ fontSize: 12, color: "#6b7280" }}>
                    {e.patient_name} · <strong>{e.hospital_name}</strong> ·{" "}
                    {formatDistanceToNow(parseISO(e.created_at), { addSuffix: true })}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 12 }}>
                  {e.officer_name && (
                    <button
                      onClick={(ev) => { ev.stopPropagation(); setCalling(e); }}
                      style={{ padding: "6px 14px", background: "#059669", color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >
                      📞 Call Officer
                    </button>
                  )}
                  <span style={{ color: "#d1d5db", fontSize: 16 }}>{expanded === e.id ? "▲" : "▼"}</span>
                </div>
              </div>

              {expanded === e.id && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f3f4f6" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div>
                      <h4 style={{ fontWeight: 700, marginBottom: 8, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#374151" }}>Complaint</h4>
                      <p style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6, color: "#374151" }}>{e.raw_text}</p>
                    </div>
                    <div>
                      <h4 style={{ fontWeight: 700, marginBottom: 8, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#374151" }}>Officer</h4>
                      {e.officer_name ? (
                        <div>
                          <p style={{ fontWeight: 700, fontSize: 14 }}>{e.officer_name}</p>
                          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>{e.officer_email}</p>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{
                              padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                              background: e.officer_total_breaches > 2 ? "#fee2e2" : "#fef3c7",
                              color: e.officer_total_breaches > 2 ? "#dc2626" : "#92400e",
                            }}>
                              {e.officer_total_breaches} total breaches
                            </span>
                          </div>
                          {e.officer_total_breaches > 2 && (
                            <p style={{ fontSize: 12, color: "#dc2626", marginTop: 8 }}>
                              ⚠️ This officer has a pattern of SLA violations. Consider reassignment.
                            </p>
                          )}
                        </div>
                      ) : (
                        <p style={{ color: "#9ca3af", fontSize: 13 }}>Complaint was unassigned.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Call officer popup */}
      {calling && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: "white", borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          padding: "20px 24px", minWidth: 260, border: "1px solid #e5e7eb",
          animation: "slideUp 0.3s ease",
        }}>
          <style>{`@keyframes slideUp { from { transform: translateY(60px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#1d4ed8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              👮
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 1 }}>{calling.officer_name}</p>
              <p style={{ fontSize: 12, color: "#6b7280" }}>{calling.officer_email}</p>
              <p style={{ fontSize: 11, color: "#dc2626", fontWeight: 600 }}>Re: {calling.complaint_code}</p>
            </div>
          </div>
          <p style={{ fontSize: 18, fontWeight: 700, textAlign: "center", color: "#1d4ed8", marginBottom: 16, letterSpacing: 2 }}>
            {fmt(callSecs)}
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
            {calling.officer_phone ? (
              <a href={`tel:${calling.officer_phone}`} style={{
                width: 52, height: 52, borderRadius: "50%", background: "#059669",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, textDecoration: "none", boxShadow: "0 4px 12px rgba(5,150,105,0.4)",
              }}>📞</a>
            ) : (
              <a href={`mailto:${calling.officer_email}`} style={{
                width: 52, height: 52, borderRadius: "50%", background: "#1d4ed8",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, textDecoration: "none", boxShadow: "0 4px 12px rgba(29,78,216,0.4)",
              }}>✉️</a>
            )}
            <button onClick={() => setCalling(null)} style={{
              width: 52, height: 52, borderRadius: "50%", background: "#dc2626",
              border: "none", fontSize: 22, cursor: "pointer",
              boxShadow: "0 4px 12px rgba(220,38,38,0.4)", color: "white",
            }}>✕</button>
          </div>
          <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 10 }}>
            {calling.officer_phone ? "Click 📞 to call · ✕ to dismiss" : "Click ✉️ to email · ✕ to dismiss"}
          </p>
        </div>
      )}
    </Layout>
  );
}
