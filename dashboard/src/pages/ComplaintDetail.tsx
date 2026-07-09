import { useEffect, useState, useRef } from "react";
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
  hospital_name: string; hospital_phone?: string; hospital_address?: string;
  department_name: string; acknowledged_at: string | null;
  patient_confirmed_resolved: boolean | null; is_anonymous: boolean;
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
  const [calling, setCalling] = useState(false);
  const [callTimer, setCallTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  function load() {
    if (!id) return;
    api.get(`/officer/complaints/${id}`).then((r) => {
      setComplaint(r.data.complaint);
      setMessages(r.data.messages);
    }).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (calling) {
      timerRef.current = setInterval(() => setCallTimer(t => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setCallTimer(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [calling]);

  function formatTimer(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  async function acknowledge() {
    if (!id) return;
    setActionLoading("ack");
    await api.post(`/officer/complaints/${id}/acknowledge`);
    setActionLoading(""); setAckSuccess(true); load();
  }

  async function resolve() {
    if (!id) return;
    setActionLoading("res");
    await api.post(`/officer/complaints/${id}/resolve`);
    setActionLoading(""); setResolveSuccess(true); load();
  }

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!replyText.trim() || !id) return;
    await api.post(`/officer/complaints/${id}/message`, { text: replyText });
    setReplyText(""); load();
  }

  if (loading) return <Layout nav={NAV}><p style={{ padding: 20 }}>Loading…</p></Layout>;
  if (!complaint) return <Layout nav={NAV}><p style={{ padding: 20 }}>Complaint not found.</p></Layout>;

  const c = complaint;
  const canAck = c.status === "new" || c.status === "escalated";
  const canResolve = c.status === "acknowledged" || c.status === "reopened";
  const awaitingConfirm = c.status === "resolved" && !c.patient_confirmed_resolved;
  const phone = c.hospital_phone || "";

  const urgencyColors: Record<string, string> = {
    critical: "#dc2626", high: "#f59e0b", normal: "#3b82f6", low: "#6b7280"
  };
  const urgencyBg: Record<string, string> = {
    critical: "#fff1f2", high: "#fffbeb", normal: "#eff6ff", low: "#f9fafb"
  };

  return (
    <Layout nav={NAV}>
      {/* Header bar */}
      <div style={{
        background: "white", borderRadius: 12, padding: "16px 20px", marginBottom: 16,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        borderLeft: `5px solid ${urgencyColors[c.urgency] ?? "#6b7280"}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>{c.complaint_code}</span>
              <span style={{
                padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: 0.5,
                background: urgencyBg[c.urgency], color: urgencyColors[c.urgency]
              }}>{c.urgency}</span>
              <span className={`badge badge-${c.status}`}>{c.status.replace(/_/g, " ")}</span>
              {c.category && (
                <span style={{ fontSize: 12, color: "#1d4ed8", background: "#eff6ff", padding: "2px 10px", borderRadius: 20 }}>
                  {c.category.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <p style={{ color: "#6b7280", fontSize: 13 }}>
              {c.is_anonymous ? "Anonymous patient" : c.patient_name}
              {!c.is_anonymous && c.patient_mobile ? ` · ${c.patient_mobile}` : ""} ·{" "}
              <strong style={{ color: "#374151" }}>{c.hospital_name}</strong>
              {c.department_name ? ` · ${c.department_name}` : ""} ·{" "}
              {formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {phone && (
              <button
                onClick={() => setCalling(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 16px", borderRadius: 8, border: "none",
                  background: "#059669", color: "white", fontWeight: 600, fontSize: 13,
                  cursor: "pointer", transition: "all 0.2s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#047857")}
                onMouseLeave={e => (e.currentTarget.style.background = "#059669")}
              >
                📞 Call Hospital
              </button>
            )}
            {canAck && (
              <button className="btn btn-primary" onClick={acknowledge} disabled={actionLoading === "ack"}
                style={{ background: ackSuccess ? "#059669" : "#1d4ed8", transition: "background 0.3s" }}>
                {actionLoading === "ack" ? "…" : ackSuccess ? "✓ Acknowledged" : "Mark Acknowledged"}
              </button>
            )}
            {canResolve && (
              <button className="btn btn-success" onClick={resolve} disabled={actionLoading === "res"}
                style={{ background: resolveSuccess ? "#16a34a" : "#059669", transition: "background 0.3s" }}>
                {actionLoading === "res" ? "…" : resolveSuccess ? "✓ Resolved" : "Mark Resolved"}
              </button>
            )}
            {awaitingConfirm && (
              <span style={{ padding: "8px 16px", borderRadius: 8, background: "#fef3c7", color: "#92400e", fontWeight: 600, fontSize: 13 }}>
                ⏳ Awaiting patient confirmation
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, height: "calc(100vh - 220px)" }}>

        {/* Left: complaint + chat */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, overflow: "hidden" }}>

          {/* Complaint text */}
          <div className="card" style={{ flexShrink: 0 }}>
            <h3 style={{ fontWeight: 700, marginBottom: 8, fontSize: 14, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Complaint
            </h3>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, color: "#111827", fontSize: 14 }}>{c.raw_text}</p>
            {c.raw_audio_url && (
              <p style={{ marginTop: 8, fontSize: 12, color: "#6b7280", display: "flex", alignItems: "center", gap: 4 }}>
                🎙️ Voice note recorded
              </p>
            )}
          </div>

          {/* Conversation — scrollable only inside */}
          <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 14, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0 }}>
              Conversation Thread
            </h3>

            <div ref={chatRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4, marginBottom: 12 }}>
              {messages.length === 0 && (
                <p style={{ color: "#9ca3af", fontSize: 13, textAlign: "center", marginTop: 20 }}>No messages yet.</p>
              )}
              {messages.map((m) => (
                <div key={m.id} style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: m.sender_type === "officer" ? "#dbeafe" : m.sender_type === "system" ? "#f3f4f6" : "#dcfce7",
                  alignSelf: m.sender_type === "officer" ? "flex-end" : "flex-start",
                  maxWidth: "78%", boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                }}>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 3, textTransform: "capitalize", fontWeight: 600 }}>
                    {m.sender_type} · {formatDistanceToNow(parseISO(m.created_at), { addSuffix: true })}
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.5, color: "#111827" }}>{m.message_text}</p>
                </div>
              ))}
            </div>

            <form onSubmit={sendReply} style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Send a message to the patient…"
                style={{
                  flex: 1, padding: "10px 14px", borderRadius: 8,
                  border: "1px solid #e5e7eb", fontSize: 13, outline: "none",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => (e.target.style.borderColor = "#3b82f6")}
                onBlur={e => (e.target.style.borderColor = "#e5e7eb")}
              />
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!replyText.trim()}
                style={{ borderRadius: 8, padding: "10px 20px" }}
              >
                Send
              </button>
            </form>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>

          {/* Hospital info + call */}
          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 14, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>
              🏥 Hospital
            </h3>
            <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{c.hospital_name}</p>
            {c.department_name && <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>{c.department_name}</p>}
            {c.hospital_address && <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>📍 {c.hospital_address}</p>}
            {phone ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0fdf4", padding: "10px 12px", borderRadius: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#065f46" }}>📞 {phone}</span>
                <button
                  onClick={() => setCalling(true)}
                  style={{ marginLeft: "auto", padding: "5px 12px", background: "#059669", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  Call
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "#9ca3af" }}>No phone number on file.</p>
            )}
          </div>

          {/* SLA Timers */}
          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 14, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>
              ⏱ SLA Status
            </h3>
            <SlaRow label="Acknowledgment" value={c.ack_sla_deadline} done={!!c.acknowledged_at} />
            <SlaRow label="Resolution" value={c.resolution_sla_deadline} done={c.status === "resolved"} />
          </div>

          {/* Patient info */}
          {!c.is_anonymous && (
            <div className="card">
              <h3 style={{ fontWeight: 700, marginBottom: 10, fontSize: 14, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>
                👤 Patient
              </h3>
              <p style={{ fontWeight: 600, marginBottom: 2 }}>{c.patient_name}</p>
              {c.patient_mobile && <p style={{ fontSize: 13, color: "#6b7280" }}>📱 {c.patient_mobile}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Call popup — bottom right corner, WhatsApp style */}
      {calling && phone && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: "white", borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          padding: "20px 24px", minWidth: 260,
          animation: "slideUp 0.3s ease",
          border: "1px solid #e5e7eb",
        }}>
          <style>{`@keyframes slideUp { from { transform: translateY(60px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              🏥
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 1 }}>{c.hospital_name}</p>
              <p style={{ fontSize: 12, color: "#6b7280" }}>{phone}</p>
            </div>
          </div>
          <p style={{ fontSize: 18, fontWeight: 700, textAlign: "center", color: "#059669", marginBottom: 16, letterSpacing: 2 }}>
            {formatTimer(callTimer)}
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
            <a
              href={`tel:${phone}`}
              style={{
                width: 52, height: 52, borderRadius: "50%", background: "#059669",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, textDecoration: "none", boxShadow: "0 4px 12px rgba(5,150,105,0.4)",
              }}
            >📞</a>
            <button
              onClick={() => setCalling(false)}
              style={{
                width: 52, height: 52, borderRadius: "50%", background: "#dc2626",
                border: "none", fontSize: 22, cursor: "pointer",
                boxShadow: "0 4px 12px rgba(220,38,38,0.4)", color: "white",
              }}
            >✕</button>
          </div>
          <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 10 }}>
            Click 📞 to dial · ✕ to dismiss
          </p>
        </div>
      )}
    </Layout>
  );
}

function SlaRow({ label, value, done }: { label: string; value: string | null; done: boolean }) {
  if (!value) return null;
  const past = !done && new Date(value) < new Date();
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{
        fontWeight: 600, fontSize: 13,
        color: done ? "#059669" : past ? "#dc2626" : "#1a1a2e",
        display: "flex", alignItems: "center", gap: 4,
      }}>
        {done ? "✅ Completed" : past
          ? `⚠️ ${formatDistanceToNow(parseISO(value), { addSuffix: true })}`
          : `🕐 ${formatDistanceToNow(parseISO(value), { addSuffix: true })}`}
      </div>
    </div>
  );
}
