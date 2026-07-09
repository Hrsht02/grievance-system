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

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // Call timer
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

  return (
    // Outer wrapper: full height, no overflow on the page itself
    <Layout nav={NAV}>
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)", overflow: "hidden" }}>

        {/* ── Header bar ── */}
        <div style={{
          background: "white", borderRadius: 12, padding: "14px 18px", marginBottom: 12,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          borderLeft: `5px solid ${urgencyColors[c.urgency] ?? "#6b7280"}`,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: "#111827" }}>{c.complaint_code}</span>
                <span style={{
                  padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                  background: c.urgency === "critical" ? "#fff1f2" : c.urgency === "high" ? "#fffbeb" : "#eff6ff",
                  color: urgencyColors[c.urgency],
                }}>{c.urgency}</span>
                <span className={`badge badge-${c.status}`}>{c.status.replace(/_/g, " ")}</span>
                {c.category && (
                  <span style={{ fontSize: 11, color: "#6366f1", background: "#eef2ff", padding: "2px 10px", borderRadius: 20 }}>
                    {c.category.replace(/_/g, " ")}
                  </span>
                )}
              </div>
              <p style={{ color: "#6b7280", fontSize: 13 }}>
                {c.is_anonymous ? "Anonymous" : c.patient_name}
                {!c.is_anonymous && c.patient_mobile ? ` · ${c.patient_mobile}` : ""} ·{" "}
                <strong style={{ color: "#374151" }}>{c.hospital_name}</strong>
                {c.department_name ? ` · ${c.department_name}` : ""} ·{" "}
                {formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {canAck && (
                <button className="btn btn-primary" onClick={acknowledge} disabled={actionLoading === "ack"}
                  style={{ background: ackSuccess ? "#059669" : "#1d4ed8", transition: "background 0.3s", borderRadius: 8 }}>
                  {actionLoading === "ack" ? "…" : ackSuccess ? "✓ Acknowledged" : "Mark Acknowledged"}
                </button>
              )}
              {canResolve && (
                <button className="btn btn-success" onClick={resolve} disabled={actionLoading === "res"}
                  style={{ background: resolveSuccess ? "#16a34a" : "#059669", transition: "background 0.3s", borderRadius: 8 }}>
                  {actionLoading === "res" ? "…" : resolveSuccess ? "✓ Resolved" : "Mark Resolved"}
                </button>
              )}
              {awaitingConfirm && (
                <span style={{ padding: "8px 14px", borderRadius: 8, background: "#fef3c7", color: "#92400e", fontWeight: 600, fontSize: 13 }}>
                  ⏳ Awaiting confirmation
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Main content: fills remaining height, no scroll ── */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", gap: 12, minHeight: 0 }}>

          {/* Left: complaint text + chat — flex column, chat grows */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>

            {/* Complaint text — fixed height */}
            <div className="card" style={{ flexShrink: 0, padding: "14px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#9ca3af", marginBottom: 6 }}>
                Complaint
              </p>
              <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, color: "#111827", fontSize: 14 }}>{c.raw_text}</p>
              {c.raw_audio_url && (
                <p style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>🎙️ Voice note recorded</p>
              )}
            </div>

            {/* Chat — flex: 1 so it fills all remaining height */}
            <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "14px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#9ca3af", marginBottom: 10, flexShrink: 0 }}>
                Conversation Thread
              </p>

              {/* Scrollable chat messages only */}
              <div ref={chatRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, paddingRight: 2 }}>
                {messages.length === 0 && (
                  <p style={{ color: "#9ca3af", fontSize: 13, textAlign: "center", marginTop: 16 }}>No messages yet.</p>
                )}
                {messages.map((m) => (
                  <div key={m.id} style={{
                    padding: "9px 13px", borderRadius: 10,
                    background: m.sender_type === "officer" ? "#dbeafe" : m.sender_type === "system" ? "#f3f4f6" : "#dcfce7",
                    alignSelf: m.sender_type === "officer" ? "flex-end" : "flex-start",
                    maxWidth: "76%",
                  }}>
                    <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2, textTransform: "capitalize", fontWeight: 600 }}>
                      {m.sender_type} · {formatDistanceToNow(parseISO(m.created_at), { addSuffix: true })}
                    </div>
                    <p style={{ fontSize: 13, lineHeight: 1.5, color: "#111827" }}>{m.message_text}</p>
                  </div>
                ))}
              </div>

              {/* Reply input — always visible at bottom */}
              <form onSubmit={sendReply} style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Send a message to the patient…"
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 8,
                    border: "1px solid #e5e7eb", fontSize: 13, outline: "none",
                  }}
                  onFocus={e => (e.target.style.borderColor = "#3b82f6")}
                  onBlur={e => (e.target.style.borderColor = "#e5e7eb")}
                />
                <button className="btn btn-primary" type="submit" disabled={!replyText.trim()}
                  style={{ borderRadius: 8, padding: "10px 20px", flexShrink: 0 }}>
                  Send
                </button>
              </form>
            </div>
          </div>

          {/* Right panel — no scroll, just hospital + SLA */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>

            {/* Hospital card with call button */}
            <div className="card" style={{ flexShrink: 0, padding: "14px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#9ca3af", marginBottom: 10 }}>
                🏥 Hospital
              </p>
              <p style={{ fontWeight: 700, fontSize: 15, color: "#111827", marginBottom: 2 }}>{c.hospital_name}</p>
              {c.department_name && (
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>{c.department_name}</p>
              )}
              {c.hospital_address && (
                <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>📍 {c.hospital_address}</p>
              )}

              {phone ? (
                <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#065f46" }}>📞 {phone}</span>
                    <button
                      onClick={() => setCalling(true)}
                      style={{
                        padding: "5px 14px", background: "#059669", color: "white",
                        border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700,
                        cursor: "pointer", transition: "background 0.2s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#047857")}
                      onMouseLeave={e => (e.currentTarget.style.background = "#059669")}
                    >
                      Call
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
                  <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
                    No phone number on file.<br />
                    <span style={{ fontSize: 11 }}>Add it in the Hospitals page.</span>
                  </p>
                </div>
              )}
            </div>

            {/* SLA card */}
            <div className="card" style={{ flexShrink: 0, padding: "14px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#9ca3af", marginBottom: 12 }}>
                ⏱ SLA Status
              </p>
              <SlaRow label="Acknowledgment" value={c.ack_sla_deadline} done={!!c.acknowledged_at} />
              <SlaRow label="Resolution" value={c.resolution_sla_deadline} done={c.status === "resolved"} />
            </div>

            {/* Spacer to push cards up and use remaining space naturally */}
            <div style={{ flex: 1 }} />
          </div>
        </div>
      </div>

      {/* ── Call popup (bottom-right, WhatsApp style) ── */}
      {calling && phone && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: "white", borderRadius: 20, padding: "22px 26px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.18)", minWidth: 270,
          border: "1px solid #e5e7eb",
          animation: "slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        }}>
          <style>{`
            @keyframes slideUp {
              from { transform: translateY(80px); opacity: 0; }
              to   { transform: translateY(0);    opacity: 1; }
            }
            @keyframes pulse {
              0%,100% { box-shadow: 0 0 0 0 rgba(5,150,105,0.5); }
              50%      { box-shadow: 0 0 0 10px rgba(5,150,105,0); }
            }
          `}</style>

          {/* Hospital avatar */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(135deg,#059669,#047857)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
              animation: "pulse 1.5s infinite",
            }}>🏥</div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, color: "#111827", marginBottom: 2 }}>{c.hospital_name}</p>
              <p style={{ fontSize: 12, color: "#6b7280" }}>{phone}</p>
            </div>
          </div>

          {/* Timer */}
          <p style={{ fontSize: 26, fontWeight: 800, textAlign: "center", color: "#059669", letterSpacing: 3, marginBottom: 20 }}>
            {formatTimer(callTimer)}
          </p>

          {/* Buttons */}
          <div style={{ display: "flex", justifyContent: "center", gap: 20 }}>
            <a href={`tel:${phone}`} style={{ textDecoration: "none" }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%", background: "#059669",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, cursor: "pointer",
                boxShadow: "0 4px 14px rgba(5,150,105,0.45)",
                transition: "transform 0.15s",
              }}
                onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.08)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              >📞</div>
            </a>
            <div
              onClick={() => setCalling(false)}
              style={{
                width: 56, height: 56, borderRadius: "50%", background: "#dc2626",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, cursor: "pointer", color: "white", fontWeight: 700,
                boxShadow: "0 4px 14px rgba(220,38,38,0.45)",
                transition: "transform 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.08)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
            >✕</div>
          </div>

          <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 12 }}>
            📞 opens your phone dialer · ✕ dismisses
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
      <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 13, color: done ? "#059669" : past ? "#dc2626" : "#374151" }}>
        {done ? "✅ Completed"
          : past ? `⚠️ ${formatDistanceToNow(parseISO(value), { addSuffix: true })}`
          : `🕐 ${formatDistanceToNow(parseISO(value), { addSuffix: true })}`}
      </div>
    </div>
  );
}
