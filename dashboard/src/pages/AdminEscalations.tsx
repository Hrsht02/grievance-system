import { useEffect, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import Layout from "../components/Layout";
import api from "../api";

const NAV = [
  { label: "Overview", path: "/admin" },
  { label: "Escalations", path: "/admin/escalations" },
  { label: "Officers", path: "/admin/officers" },
];

interface Escalation {
  id: string; reason: string; escalated_to_role: string; created_at: string;
  complaint_code: string; urgency: string; category: string;
  summary_en: string; raw_text: string; complaint_status: string;
  patient_name: string; hospital_name: string;
  officer_name: string | null; officer_email: string | null;
  officer_total_breaches: number;
}

const REASON_LABELS: Record<string, string> = {
  ack_sla_breach: "Acknowledgment SLA Breach",
  resolution_sla_breach: "Resolution SLA Breach",
  patient_reopened: "Patient Rejected Resolution",
};

export default function AdminEscalations() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.get("/admin/escalations").then((r) => setItems(r.data));
  }, []);

  return (
    <Layout nav={NAV}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
        Escalations ({items.length})
      </h1>

      {items.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>
          No escalations — everything is on track. ✅
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((e) => (
          <div
            key={e.id}
            className="card"
            style={{ borderLeft: `4px solid ${e.urgency === "critical" ? "#dc2626" : "#f59e0b"}`, cursor: "pointer" }}
            onClick={() => setExpanded(expanded === e.id ? null : e.id)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>{e.complaint_code}</span>
                  <span className={`badge badge-${e.urgency}`}>{e.urgency}</span>
                  <span style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", padding: "2px 8px", borderRadius: 12, fontWeight: 600 }}>
                    {REASON_LABELS[e.reason] ?? e.reason}
                  </span>
                </div>
                <p style={{ fontWeight: 600, marginBottom: 2 }}>{e.summary_en}</p>
                <p style={{ fontSize: 12, color: "#6b7280" }}>
                  {e.patient_name} · {e.hospital_name} ·{" "}
                  {formatDistanceToNow(parseISO(e.created_at), { addSuffix: true })}
                </p>
              </div>
              <span style={{ color: "#9ca3af", fontSize: 18 }}>{expanded === e.id ? "▲" : "▼"}</span>
            </div>

            {expanded === e.id && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f3f4f6" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <h4 style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>Full Complaint</h4>
                    <p style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6 }}>{e.raw_text}</p>
                  </div>
                  <div>
                    <h4 style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>Responsible Officer</h4>
                    {e.officer_name ? (
                      <>
                        <p><strong>{e.officer_name}</strong></p>
                        <p style={{ color: "#6b7280", fontSize: 13 }}>{e.officer_email}</p>
                        <p style={{ marginTop: 6, fontSize: 13 }}>
                          Total SLA breaches:{" "}
                          <span style={{ fontWeight: 700, color: e.officer_total_breaches > 2 ? "#dc2626" : "#1a1a2e" }}>
                            {e.officer_total_breaches}
                          </span>
                        </p>
                      </>
                    ) : (
                      <p style={{ color: "#6b7280", fontSize: 13 }}>Complaint was unassigned.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
