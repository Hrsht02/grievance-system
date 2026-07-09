import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const reason = new URLSearchParams(window.location.search).get("reason");
  const sessionExpired = reason === "session_expired";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("username", email);
      params.append("password", password);
      const { data } = await api.post("/auth/token", params);
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("role", data.role);
      navigate(data.role === "superadmin" ? "/admin" : "/officer");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: 380, padding: 36 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Bihar Grievance System</h1>
        <p style={{ color: "#6b7280", marginBottom: 24, fontSize: 13 }}>Officer & Admin Portal</p>

        {sessionExpired && (
          <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, padding: "10px 12px", marginBottom: 16, color: "#92400e", fontSize: 13 }}>
            Your session expired. Please sign in again.
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
              style={{ width: "100%", padding: "9px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              style={{ width: "100%", padding: "9px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }} />
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 6 }}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
