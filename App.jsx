import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBFchmw6b2Q7-qygQaezGBEqKJbKxPC76c",
  authDomain: "finance-agent-ae585.firebaseapp.com",
  projectId: "finance-agent-ae585",
  storageBucket: "finance-agent-ae585.firebasestorage.app",
  messagingSenderId: "777226272238",
  appId: "1:777226272238:web:c470b3d4937cec580ea2ff",
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const provider = new GoogleAuthProvider();

const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN;
const AIRTABLE_BASE = "appClMfjTrAEOKxdi";
const USERS_TABLE = "tbl7F2aJ0hB8d2jFX";
const HISTORY_TABLE = "tbl6SeMliXAUlC9ca";

const FREQUENCY_OPTIONS = [
  { value: "Daily",   label: "Daily",   desc: "Every morning" },
  { value: "Weekly",  label: "Weekly",  desc: "Every Monday" },
  { value: "Monthly", label: "Monthly", desc: "1st of month" },
  { value: "Never",   label: "Paused",  desc: "No emails" },
];

const airtableFetch = async (url, options = {}) => {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res.json();
};

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [airtableRecord, setAirtableRecord] = useState(null);
  const [philosophy, setPhilosophy] = useState("");
  const [tickers, setTickers] = useState("");
  const [frequency, setFrequency] = useState("Daily");
  const [briefings, setBriefings] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("profile");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await loadUserData(firebaseUser.email);
        await loadBriefings(firebaseUser.email);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const loadUserData = async (email) => {
    const data = await airtableFetch(
      `${USERS_TABLE}?filterByFormula=${encodeURIComponent(`{Email} = '${email}'`)}`
    );
    if (data.records && data.records.length > 0) {
      const record = data.records[0];
      setAirtableRecord(record);
      setPhilosophy(record.fields.Philosophy || "");
      setTickers(record.fields.Tickers || "");
      setFrequency(record.fields.Frequency || "Daily");
    } else {
      const newRecord = await airtableFetch(USERS_TABLE, {
        method: "POST",
        body: JSON.stringify({
          records: [{
            fields: {
              Name: email.split("@")[0],
              Email: email,
              Philosophy: "",
              Tickers: "",
              Frequency: "Daily",
              Active: true,
            },
          }],
        }),
      });
      if (newRecord.records) {
        setAirtableRecord(newRecord.records[0]);
        setFrequency("Daily");
      }
    }
  };

  const loadBriefings = async (email) => {
    const data = await airtableFetch(
      `${HISTORY_TABLE}?filterByFormula=${encodeURIComponent(`{Email} = '${email}'`)}&sort[0][field]=Date&sort[0][direction]=desc&maxRecords=10`
    );
    if (data.records) {
      setBriefings(data.records.map((r) => r.fields));
    }
  };

  const handleSave = async () => {
    if (!airtableRecord) return;
    setSaving(true);
    await airtableFetch(`${USERS_TABLE}/${airtableRecord.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: { Philosophy: philosophy, Tickers: tickers },
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleFrequencyChange = async (newFreq) => {
    if (!airtableRecord) return;
    setFrequency(newFreq);
    await airtableFetch(`${USERS_TABLE}/${airtableRecord.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { Frequency: newFreq } }),
    });
  };

  const handleLogin = async () => {
    try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setAirtableRecord(null);
    setPhilosophy("");
    setTickers("");
    setFrequency("Daily");
    setBriefings([]);
  };

  if (loading) return <div style={styles.centered}><div style={styles.spinner} /></div>;

  if (!user) {
    return (
      <div style={styles.centered}>
        <div style={styles.loginCard}>
          <h1 style={styles.logo}>📈 Finance Agent</h1>
          <p style={styles.tagline}>Your personalised AI investment briefing, every morning.</p>
          <button style={styles.googleBtn} onClick={handleLogin}>
            <GoogleIcon /> Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <span style={styles.logo}>📈 Finance Agent</span>
        <div style={styles.userInfo}>
          <img src={user.photoURL} alt="" style={styles.avatar} />
          <span style={styles.userName}>{user.displayName}</span>
          <button style={styles.logoutBtn} onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <div style={styles.tabs}>
        <button style={tab === "profile" ? styles.tabActive : styles.tab} onClick={() => setTab("profile")}>My Profile</button>
        <button style={tab === "briefings" ? styles.tabActive : styles.tab} onClick={() => setTab("briefings")}>Past Briefings</button>
      </div>

      <main style={styles.main}>
        {tab === "profile" && (
          <div style={styles.card}>
            <h2 style={styles.sectionTitle}>My Investment Profile</h2>
            <p style={styles.hint}>Your briefing is generated based on this profile. Changes take effect on the next send.</p>

            <label style={styles.label}>Investment Philosophy</label>
            <textarea
              style={styles.textarea}
              value={philosophy}
              onChange={(e) => setPhilosophy(e.target.value)}
              placeholder="Describe how you invest..."
              rows={6}
            />

            <label style={styles.label}>Stock Tickers</label>
            <input
              style={styles.input}
              value={tickers}
              onChange={(e) => setTickers(e.target.value)}
              placeholder="BRK.B, JPM, JNJ, GOOGL, KO"
            />
            <p style={styles.hint}>Comma-separated. e.g. AAPL, MSFT, TSLA</p>

            <button
              style={saving ? styles.saveBtnDisabled : styles.saveBtn}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : saved ? "✓ Saved" : "Save Changes"}
            </button>

            <hr style={styles.divider} />

            <label style={styles.label}>Briefing Frequency</label>
            <div style={styles.frequencyGrid}>
              {FREQUENCY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  style={frequency === opt.value ? styles.freqBtnActive : styles.freqBtn}
                  onClick={() => handleFrequencyChange(opt.value)}
                >
                  <span style={styles.freqLabel}>{opt.label}</span>
                  <span style={styles.freqDesc}>{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "briefings" && (
          <div style={styles.card}>
            <h2 style={styles.sectionTitle}>Past Briefings</h2>
            {briefings.length === 0 ? (
              <p style={styles.hint}>No briefings yet. Your first one arrives on your next scheduled send.</p>
            ) : (
              briefings.map((b, i) => (
                <div key={i} style={styles.briefingItem}>
                  <div style={styles.briefingDate}>{b.Date || "—"}</div>
                  <div style={styles.briefingText}>{b.Briefing}</div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: 10 }}>
      <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z"/>
      <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z"/>
      <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z"/>
      <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.4L4.5 7.49a4.77 4.77 0 014.48-3.3z"/>
    </svg>
  );
}

const styles = {
  app: { minHeight: "100vh", background: "#f5f5f7", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  centered: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f5f5f7" },
  loginCard: { background: "#fff", borderRadius: 16, padding: "48px 40px", textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", maxWidth: 400, width: "90%" },
  logo: { fontSize: 24, fontWeight: 700, color: "#1d1d1f", margin: 0 },
  tagline: { color: "#6e6e73", fontSize: 15, margin: "12px 0 32px" },
  googleBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "12px 20px", border: "1px solid #dadce0", borderRadius: 8, background: "#fff", fontSize: 15, fontWeight: 500, cursor: "pointer", color: "#3c4043" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", background: "#fff", borderBottom: "1px solid #e5e5e5" },
  userInfo: { display: "flex", alignItems: "center", gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: "50%" },
  userName: { fontSize: 14, color: "#1d1d1f", fontWeight: 500 },
  logoutBtn: { fontSize: 13, color: "#0066cc", background: "none", border: "none", cursor: "pointer", padding: "4px 8px" },
  tabs: { display: "flex", background: "#fff", borderBottom: "1px solid #e5e5e5", padding: "0 24px" },
  tab: { padding: "14px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#6e6e73", fontWeight: 500, borderBottom: "2px solid transparent" },
  tabActive: { padding: "14px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#0066cc", fontWeight: 600, borderBottom: "2px solid #0066cc" },
  main: { maxWidth: 720, margin: "32px auto", padding: "0 24px" },
  card: { background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" },
  sectionTitle: { fontSize: 20, fontWeight: 700, color: "#1d1d1f", margin: "0 0 8px" },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#1d1d1f", margin: "20px 0 6px" },
  hint: { fontSize: 13, color: "#6e6e73", margin: "4px 0 0" },
  textarea: { width: "100%", padding: "12px", borderRadius: 8, border: "1px solid #d2d2d7", fontSize: 14, lineHeight: 1.6, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", color: "#1d1d1f" },
  input: { width: "100%", padding: "12px", borderRadius: 8, border: "1px solid #d2d2d7", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", color: "#1d1d1f" },
  saveBtn: { marginTop: 24, padding: "12px 28px", background: "#0066cc", color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer" },
  saveBtnDisabled: { marginTop: 24, padding: "12px 28px", background: "#a0b4c8", color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "not-allowed" },
  divider: { border: "none", borderTop: "1px solid #f0f0f0", margin: "28px 0" },
  frequencyGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 },
  freqBtn: { display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 8px", border: "1.5px solid #d2d2d7", borderRadius: 10, background: "#fff", cursor: "pointer", gap: 4 },
  freqBtnActive: { display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 8px", border: "1.5px solid #0066cc", borderRadius: 10, background: "#f0f6ff", cursor: "pointer", gap: 4 },
  freqLabel: { fontSize: 14, fontWeight: 600, color: "#1d1d1f" },
  freqDesc: { fontSize: 11, color: "#6e6e73", textAlign: "center" },
  briefingItem: { borderBottom: "1px solid #f0f0f0", padding: "20px 0" },
  briefingDate: { fontSize: 12, fontWeight: 600, color: "#6e6e73", marginBottom: 8 },
  briefingText: { fontSize: 14, lineHeight: 1.7, color: "#1d1d1f" },
  spinner: { width: 32, height: 32, border: "3px solid #e5e5e5", borderTop: "3px solid #0066cc", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
};
