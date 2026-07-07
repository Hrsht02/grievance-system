import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow, isPast, parseISO } from "date-fns";
import Layout from "../components/Layout";
import api from "../api";

const NAV = [{ label: "My Complaints", path: "/officer" }];

interface Complaint {
  id: string;
  complaint_code: string;
  status: string;
  urgency: string;
  category: string;
  summary_en: string;
  created_at: string;
  ack_sla_deadline: string;
  patient_name: string;
  hospital_name: string;
  department_name: string;
}

export default function OfficerDashboard() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [filter, setFilter] = useState<string>("active");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = filter === "active" ? "" : `?status_filter=${filter}`;
    api.get(`/officer/complaints${params}`).then((r) => {
      let data: Complaint[] = r.data;
      if (filter === "active") {
        data = data.filter((c) => !["resolved"].includes(c.status));
      }
      setComplaints(data);
    }).finally(() => setLoading(false));
  }, [filter]);

  const overdue = complaints.filter(
    (c) => c.status === "new" && c.ack_sla_deadline && isPast(parseISO(c.ack_sla_deadline))
  );

  return (
    <Layout nav={NAV}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>My Complaints</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {["active", "acknowledged", "resolved", "escalated"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`btn ${filter === s ? "btn-primary" : "btn-ghost"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {overdue.length > 0 && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "12px 16px", marginBottom: 16, color: "#991b1b" }}>
          ⚠️ <strong>{overdue.length} complaint{overdue.length > 1 ? "s" : ""}</strong> past acknowledgment SLA — please acknowledge immediately.
        </div>
      )}

      {loading ? (
        <p style={{ color: "#6b7280" }}>Loading…</p>
      ) : complaints.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>
          No complaints in this view.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {complaints.map((c) => <ComplaintRow key={c.id} complaint={c} />)}
        </div>
      )}
    </Layout>
  );
}

function ComplaintRow({ complaint: c }: { complaint: Complaint }) {
  const ackOverdue = c.status === "new" && c.ack_sla_deadline && isPast(parseISO(c.ack_sla_deadline));

  return (
    <Link to={`/officer/complaints/${c.id}`}>
      <div className="card" style={{
        display: "flex", alignItems: "flex-start", gap: 14,
        borderLeft: `4px solid ${urgencyColor(c.urgency)}`,
        cursor: "pointer", transition: "box-shadow 0.15s",
      }}
        onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)")}
        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "")}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: "#374151" }}>{c.complaint_code}</span>
            <span className={`badge badge-${c.urgency}`}>{c.urgency}</span>
            <span className={`badge badge-${c.status}`}>{c.status}</span>
            {c.category && (
              <span style={{ fontSize: 12, color: "#1d4ed8", background: "#eff6ff", padding: "2px 8px", borderRadius: 12 }}>
                {c.category.replace(/_/g, " ")}
              </span>
            )}
            {ackOverdue && (
              <span style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", padding: "2px 8px", borderRadius: 12, fontWeight: 700 }}>
                ACK OVERDUE
              </span>
            )}
          </div>
          <p style={{ fontWeight: 600, marginBottom: 2 }}>{c.summary_en}</p>
          <p style={{ fontSize: 12, color: "#6b7280" }}>
            {c.patient_name} · {c.hospital_name}{c.department_name ? ` · ${c.department_name}` : ""} ·{" "}
            {formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}
          </p>
        </div>
      </div>
    </Link>
  );
}

function urgencyColor(urgency: string) {
  return { critical: "#dc2626", high: "#f59e0b", normal: "#3b82f6", low: "#d1d5db" }[urgency] ?? "#d1d5db";
}
