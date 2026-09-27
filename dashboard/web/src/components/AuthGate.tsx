import { useEffect, useState } from "react";
import { useStore } from "../store/store";
import { store } from "../store/store";
import {
  checkAuth, setupBegin, setupComplete,
  loginBegin, loginComplete,
} from "../lib/auth";

function SetupScreen() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSetup() {
    if (!token.trim()) return;
    setBusy(true);
    setStatus("Requesting registration...");
    try {
      const options = await setupBegin(token.trim());
      options.challenge = b64ToBuf(options.challenge as unknown as string);
      (options as any).user.id = b64ToBuf((options as any).user.id);
      if ((options as any).excludeCredentials) {
        for (const c of (options as any).excludeCredentials) c.id = b64ToBuf(c.id);
      }
      setStatus("Touch your authenticator...");
      const cred = await navigator.credentials.create({ publicKey: options });
      if (!cred) { setStatus("Registration cancelled"); setBusy(false); return; }
      setStatus("Verifying...");
      await setupComplete(cred);
      store.setAuth(true, true);
    } catch (e: any) {
      setStatus(e.message || "Registration failed");
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">ULT<b>RON</b></div>
        <div className="auth-title">Owner Setup</div>
        <p className="auth-hint">
          Paste the enrollment token from the server terminal.
        </p>
        <input
          className="auth-input"
          type="text"
          placeholder="Enrollment token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSetup()}
          disabled={busy}
          autoFocus
        />
        <button className="auth-btn" onClick={handleSetup} disabled={busy || !token.trim()}>
          Register Passkey
        </button>
        {status && <div className="auth-status">{status}</div>}
      </div>
    </div>
  );
}

function LoginScreen() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    setBusy(true);
    setStatus("Starting authentication...");
    try {
      const options = await loginBegin();
      setStatus("Touch your authenticator...");
      const cred = await navigator.credentials.get({ publicKey: options });
      if (!cred) { setStatus("Authentication cancelled"); setBusy(false); return; }
      setStatus("Verifying...");
      await loginComplete(cred);
      store.setAuth(true, true);
    } catch (e: any) {
      setStatus(e.message || "Authentication failed");
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">ULT<b>RON</b></div>
        <div className="auth-title">Authenticate</div>
        <p className="auth-hint">Use your registered passkey to unlock the dashboard.</p>
        <button className="auth-btn" onClick={handleLogin} disabled={busy} autoFocus>
          Sign In
        </button>
        {status && <div className="auth-status">{status}</div>}
      </div>
    </div>
  );
}

function CheckingScreen() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">ULT<b>RON</b></div>
        <div className="auth-status">Checking session...</div>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const phase = useStore((s) => s.authPhase);

  useEffect(() => {
    checkAuth().then((s) => store.setAuth(s.authenticated, s.has_owner))
      .catch(() => store.setAuth(false, false));
  }, []);

  if (phase === "checking") return <CheckingScreen />;
  if (phase === "setup") return <SetupScreen />;
  if (phase === "login") return <LoginScreen />;
  return <>{children}</>;
}

function b64ToBuf(b64: string): ArrayBuffer {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const raw = atob(s + pad);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
