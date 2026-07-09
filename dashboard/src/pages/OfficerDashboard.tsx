import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow, isPast, parseISO } from "date-fns";
import Layout from "../components/Layout";
import api from "../api";

const NAV = [
  { label: "My Complaints", path: "/officer" },
  { label: "Hospital Stats", path: "/officer#stats" },
];

interface Complaint {
  id: string; complaint_code: string; status: string; urgency: string;
  category: string; summary_en: string; created_at: string;
  ack_sla_deadline: string; patient_name: string;
  hospital_name: string; department_name: string;
}

export default function OfficerDashboard() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [filter, setFilter] = useState("active");
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<string | null>(null);
  const prevCountRef = useRef<number>(0);
  const firstLoad = useRef(true);

  const load = useCallback(() => {
    const params = filter === "active" ? "" : `?status_filter=${filter}`;
    api.get(`/officer/complaints${params}`).then((r) => {
      let data: Complaint[] = r.data;
      if (filter === "active") {
        data = data.filter((c) => c.status !== "resolved");
      }
      // New complaint notification
      const newCount = data.filter(c => c.status === "new").length;
      if (!firstLoad.current && newCount > prevCountRef.current) {
        const diff = newCount - prevCountRef.current;
        setNotification(`🔔 ${diff} new complaint${diff > 1 ? "s" : ""} received!`);
        setTimeout(() => setNotification(null), 5000);
        if (Notification.permission === "granted") {
          new Notification("Bihar Grievance", { body: `${diff} new complaint${diff > 1 ? "s" : ""} received` });
        }
      }
      prevCountRef.current = newCount;
      firstLoad.current = false;
      setComplaints(data);
    }).finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    firstLoad.current = true;
    load();
    // Request notification permission
    if (Notification.permission === "default") Notification.requestPermission();
    // Poll every 30s for new complaints
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [filter, load]);

  const overdue = complaints.filter(
    (c) => c.status === "new" && c.ack_sla_deadline && isPast(parseISO(c.ack_sla_deadline))
  );

  // Hospital stats from current complaints
  const hospitalStats = complaints.reduce<Record<string, number>>((acc, c) => {
    acc[c.hospital_name] = (acc[c.hospital_name] || 0) + 1;
    return acc;
  }, {});
  const topHospitals = Object.entries(hospitalStats).sort((a, b) => b[1] - a[1]);

  return (
    <Layout nav={NAV}>
      {/* Toast notification */}
      {notification && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: "#1d4ed8", color: "white", padding: "14px 20px",
          borderRadius: 12, boxShadow: "0 8px 24px rgba(29,78,216,0.4)",
          fontSize: 14, fontWeight: 600,
          animation: "slideDown 0.3s ease",
        }}>
          <style>{`@keyframes slideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
          {notification}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>My Complaints</h1>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
            {complaints.length} total · {complaints.filter(c => c.status === "new").length} new
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["active", "acknowledged", "resolved", "escalated"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              style={{
                padding: "6px 16px", borderRadius: 20, border: "none", fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all 0.15s",
                background: filter === s ? "#1d4ed8" : "#f3f4f6",
                color: filter === s ? "white" : "#6b7280",
              }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {overdue.length > 0 && (
        <div style={{
          background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10,
          padding: "12px 16px", marginBottom: 14, color: "#be123c",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          ⚠️ <strong>{overdue.length} complaint{overdue.length > 1 ? "s" : ""}</strong> past acknowledgment SLA — acknowledge immediately.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, alignItems: "start" }}>
        {/* Complaints list */}
        <div>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Loading…</div>
          ) : complaints.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
              No complaints in this view.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {complaints.map((c) => <ComplaintRow key={c.id} complaint={c} />)}
            </div>
          )}
        </div>

        {/* Hospital stats sidebar */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, color: "#374151" }}>
            🏥 Complaints by Hospital
          </h3>
          {topHospitals.length === 0 ? (
            <p style={{ fontSize: 13, color: "#9ca3af" }}>No data yet.</p>
          ) : topHospitals.map(([name, count]) => {
            const max = topHospitals[0][1];
            const pct = (count / max) * 100;
            const isHigh = count === max && count > 1;
            return (
              <div key={name} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: isHigh ? "#dc2626" : "#374151", fontWeight: isHigh ? 700 : 400 }}>{name}</span>
                  <span style={{ fontWeight: 700, color: isHigh ? "#dc2626" : "#374151" }}>{count}</span>
                </div>
                <div style={{ height: 5, background: "#f3f4f6", borderRadius: 3 }}>
                  <div style={{ height: 5, width: `${pct}%`, background: isHigh ? "#dc2626" : "#1d4ed8", borderRadius: 3 }} />
                </div>
                {isHigh && <p style={{ fontSize: 10, color: "#dc2626", marginTop: 2 }}>⚠️ Most complaints</p>}
              </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}

function ComplaintRow({ complaint: c }: { complaint: Complaint }) {
  const ackOverdue = c.status === "new" && c.ack_sla_deadline && isPast(parseISO(c.ack_sla_deadline));
  const urgencyColors: Record<string, string> = { critical: "#dc2626", high: "#f59e0b", normal: "#3b82f6", low: "#d1d5db" };

  return (
    <Link to={`/officer/complaints/${c.id}`} style={{ textDecoration: "none" }}>
      <div style={{
        background: "white", borderRadius: 10, padding: "14px 16px",
        borderLeft: `4px solid ${urgencyColors[c.urgency] ?? "#d1d5db"}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.07)", transition: "all 0.15s", cursor: "pointer",
      }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.12)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.07)"; e.currentTarget.style.transform = "none"; }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 5 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: "#374151" }}>{c.complaint_code}</span>
              <span style={{
                padding: "1px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                textTransform: "uppercase",
                background: c.urgency === "critical" ? "#fff1f2" : c.urgency === "high" ? "#fffbeb" : "#eff6ff",
                color: c.urgency === "critical" ? "#be123c" : c.urgency === "high" ? "#92400e" : "#1e40af",
              }}>{c.urgency}</span>
              <span className={`badge badge-${c.status}`}>{c.status}</span>
              {c.category && (
                <span style={{ fontSize: 10, color: "#6366f1", background: "#eef2ff", padding: "1px 8px", borderRadius: 20 }}>
                  {c.category.replace(/_/g, " ")}
                </span>
              )}
              {ackOverdue && (
                <span style={{ fontSize: 10, color: "#dc2626", background: "#fee2e2", padding: "1px 8px", borderRadius: 20, fontWeight: 700 }}>
                  ACK OVERDUE
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: "#111827", fontWeight: 500, marginBottom: 3, lineHeight: 1.4 }}>{c.summary_en || c.category?.replace(/_/g," ")}</p>
            <p style={{ fontSize: 11, color: "#9ca3af" }}>
              {c.patient_name} · {c.hospital_name}{c.department_name ? ` · ${c.department_name}` : ""} ·{" "}
              {formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}
            </p>
          </div>
          <div style={{ color: "#d1d5db", fontSize: 16 }}>›</div>
        </div>
      </div>
    </Link>
  );
}
