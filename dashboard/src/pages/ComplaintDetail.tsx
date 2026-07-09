import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import { formatDistanceToNow, parseISO } from "date-fns";
import Layout from "../components/Layout";
import api from "../api";

const NAV = [{ label: "← Back to Queue", path: "/officer" }];

interface Complaint {
  id: string; complaint_code: string; status: string; urgency: string;
  category: string; summary_en: string; summary_hi: string;
  raw_text: string; raw_audio_url: string; created_at: string;
  ack_sla_deadline: string; resolution_sla_deadline: string;
  patient_name: string; patient_mobile: string;
  hospital_name: string; department_name: string;
  acknowledged_at: string | null;
  patient_confirmed_resolved: boolean | null;
  is_anonymous: boolean;
}

interface Message {
  id: string; sender_type: string; message_text: string; created_at: string;
}

export default function ComplaintDetail() {
  const { id } = useParams();
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [ackSuccess, setAckSuccess] = useState(false);
  const [resolveSuccess, setResolveSuccess] = useState(false);

  function load() {
    if (!id) return;
    api.get(`/officer/complaints/${id}`).then((r) => {
      setComplaint(r.data.complaint);
      setMessages(r.data.messages);
    }).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function acknowledge() {
    if (!id) return;
    setActionLoading("ack");
    await api.post(`/officer/complaints/${id}/acknowledge`);
    setActionLoading("");
    setAckSuccess(true);
    load();
  }

  async function resolve() {
    if (!id) return;
    setActionLoading("res");
    await api.post(`/officer/complaints/${id}/resolve`);
    setActionLoading("");
    setResolveSuccess(true);
    load();
  }

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!replyText.trim() || !id) return;
    await api.post(`/officer/complaints/${id}/message`, { text: replyText });
    setReplyText("");
    load();
  }

  if (loading) return <Layout nav={NAV}><p>Loading…</p></Layout>;
  if (!complaint) return <Layout nav={NAV}><p>Complaint not found.</p></Layout>;

  const c = complaint;
  const canAck = c.status === "new" || c.status === "escalated";
  const canResolve = c.status === "acknowledged" || c.status === "reopened";
  const awaitingConfirm = c.status === "resolved" && !c.patient_confirmed_resolved;

  return (
    <Layout nav={NAV}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>{c.complaint_code}</h1>
            <span className={`badge badge-${c.urgency}`}>{c.urgency}</span>
            <span className={`badge badge-${c.status}`}>{c.status}</span>
            {c.category && (
              <span style={{ fontSize: 12, color: "#1d4ed8", background: "#eff6ff", padding: "2px 8px", borderRadius: 12 }}>
                {c.category.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <p style={{ color: "#6b7280", fontSize: 13 }}>
            {c.is_anonymous ? "Anonymous patient" : c.patient_name}
            {!c.is_anonymous && c.patient_mobile ? ` · ${c.patient_mobile}` : ""} ·{" "}
            {c.hospital_name}{c.department_name ? ` · ${c.department_name}` : ""} ·{" "}
            {formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canAck && (
            <button className="btn btn-primary" onClick={acknowledge} disabled={actionLoading === "ack"}
              style={{ background: ackSuccess ? "#059669" : "#1d4ed8", transition: "background 0.3s ease" }}>
              {actionLoading === "ack" ? "…" : ackSuccess ? "✓ Acknowledged" : "Mark Acknowledged"}
            </button>
          )}
          {canResolve && (
            <button className="btn btn-success" onClick={resolve} disabled={actionLoading === "res"}
              style={{ background: resolveSuccess ? "#16a34a" : "#059669", transition: "background 0.3s ease" }}>
              {actionLoading === "res" ? "…" : resolveSuccess ? "✓ Resolved" : "Mark Resolved"}
            </button>
          )}
          {awaitingConfirm && (
            <span style={{ padding: "8px 18px", borderRadius: 6, background: "#fef3c7", color: "#92400e", fontWeight: 600, fontSize: 14 }}>
              ⏳ Awaiting patient confirmation
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: 8, fontSize: 15 }}>Summary</h3>
            <p style={{ marginBottom: 6 }}>{c.summary_en}</p>
            {c.summary_hi && <p style={{ color: "#6b7280", fontSize: 13 }}>{c.summary_hi}</p>}
          </div>
          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: 8, fontSize: 15 }}>Full Complaint Text</h3>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{c.raw_text}</p>
            {c.raw_audio_url && (
              <p style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
                🎙️ Voice note: <code>{c.raw_audio_url}</code>
              </p>
            )}
          </div>
          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>Conversation Thread</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              {messages.length === 0 && <p style={{ color: "#6b7280" }}>No messages yet.</p>}
              {messages.map((m) => (
                <div key={m.id} style={{
                  padding: "10px 14px", borderRadius: 8,
                  background: m.sender_type === "officer" ? "#eff6ff" : m.sender_type === "system" ? "#f9fafb" : "#f0fdf4",
                  alignSelf: m.sender_type === "officer" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                }}>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3, textTransform: "capitalize" }}>
                    {m.sender_type} · {formatDistanceToNow(parseISO(m.created_at), { addSuffix: true })}
                  </div>
                  <p style={{ fontSize: 14 }}>{m.message_text}</p>
                </div>
              ))}
            </div>
            <form onSubmit={sendReply} style={{ display: "flex", gap: 8 }}>
              <input value={replyText} onChange={(e) => setReplyText(e.target.value)}
                placeholder="Send a message to the patient…"
                style={{ flex: 1, padding: "9px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }} />
              <button className="btn btn-primary" type="submit" disabled={!replyText.trim()}>Send</button>
            </form>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>SLA Timers</h3>
            <SlaRow label="Acknowledgment deadline" value={c.ack_sla_deadline} done={!!c.acknowledged_at} />
            <SlaRow label="Resolution deadline" value={c.resolution_sla_deadline} done={c.status === "resolved"} />
          </div>
        </div>
      </div>
    </Layout>
  );
}

function SlaRow({ label, value, done }: { label: string; value: string | null; done: boolean }) {
  if (!value) return null;
  const past = !done && new Date(value) < new Date();
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600, color: done ? "#059669" : past ? "#dc2626" : "#1a1a2e" }}>
        {done ? "✅ Completed" : past
          ? `⚠️ Overdue (${formatDistanceToNow(parseISO(value), { addSuffix: true })})`
          : formatDistanceToNow(parseISO(value), { addSuffix: true })}
      </div>
    </div>
  );
}
