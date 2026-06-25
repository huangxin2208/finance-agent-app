import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import VALID_TICKERS from "./tickers.json";

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
  { value: "Daily",   label: "Daily",   desc: "Every day" },
  { value: "Weekly",  label: "Weekly",  desc: "Pick a day" },
  { value: "Monthly", label: "Monthly", desc: "Pick a date" },
  { value: "Never",   label: "Paused",  desc: "No emails" },
];

const TICKER_PATTERN = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
const VALID_TICKER_SET = new Set(VALID_TICKERS);

const SAMPLE_PHILOSOPHY = "I'm a long-term value investor with a 5+ year horizon and moderate risk tolerance. I look for low P/E and P/B ratios, strong free cash flow, low debt-to-equity, and consistent or growing dividends. I avoid speculative, highly volatile stocks. I want to know about insider buying/selling and major analyst rating changes.";

// Auto-fixes whitespace/case/duplicates (cosmetic, doesn't change meaning).
// Only flags entries that aren't actually listed on NASDAQ/NYSE/AMEX - catches
// typos like "AAPLE" that look format-valid but aren't real tickers. Every
// save re-checks every ticker against the current directory, including ones
// saved previously - no grandfathering.
const normalizeTickers = (raw) => {
  const seen = new Set();
  const cleaned = [];
  const invalid = [];
  for (const entry of raw.split(",")) {
    const t = entry.trim().toUpperCase();
    if (!t) continue;
    if (!TICKER_PATTERN.test(t) || !VALID_TICKER_SET.has(t)) {
      invalid.push(t);
      continue;
    }
    if (!seen.has(t)) {
      seen.add(t);
      cleaned.push(t);
    }
  }
  return { cleaned, invalid };
};

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const getDefaultTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const getTimeZoneOptions = () => {
  try {
    if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("timeZone");
  } catch {
    // fall through to fallback list below
  }
  return ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
};

const TIME_ZONE_OPTIONS = getTimeZoneOptions();

// Well-known zones preferred as the representative for their offset group,
// in priority order - so a group shows as "UTC-04:00 (New York)" rather than
// some obscure "America/Indiana/Knox" that happens to share the same offset.
const MAJOR_ZONES = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage",
  "America/Toronto", "America/Mexico_City", "America/Bogota", "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Istanbul", "Europe/Moscow",
  "Africa/Cairo", "Africa/Lagos", "Africa/Johannesburg", "Africa/Nairobi",
  "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Jakarta",
  "Asia/Shanghai", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Perth", "Australia/Sydney", "Pacific/Auckland", "Pacific/Honolulu", "Pacific/Fiji",
];

const zoneCityLabel = (tz) => tz.split("/").pop().replace(/_/g, " ");

// Friendlier multi-city labels for the offsets most users actually pick,
// e.g. "UTC-05:00 (New York, Miami, Toronto)" - matches the standard
// convention used by most timezone pickers. Falls back to a single city
// name (derived from the zone id) for less common offsets not listed here.
const CITY_LABELS = {
  "Pacific/Honolulu": "Honolulu",
  "America/Anchorage": "Anchorage",
  "America/Los_Angeles": "Los Angeles, Seattle, Vancouver",
  "America/Denver": "Denver, Salt Lake City, Phoenix",
  "America/Chicago": "Chicago, Dallas, Mexico City",
  "America/New_York": "New York, Miami, Toronto",
  "America/Sao_Paulo": "Sao Paulo, Buenos Aires",
  "Europe/London": "London, Dublin, Lisbon",
  "Europe/Paris": "Paris, Berlin, Madrid, Rome",
  "Europe/Istanbul": "Istanbul, Athens, Cairo",
  "Europe/Moscow": "Moscow",
  "Asia/Dubai": "Dubai, Abu Dhabi",
  "Asia/Karachi": "Karachi, Islamabad",
  "Asia/Kolkata": "Mumbai, New Delhi, Kolkata",
  "Asia/Calcutta": "Mumbai, New Delhi, Kolkata",
  "Asia/Dhaka": "Dhaka",
  "Asia/Bangkok": "Bangkok, Jakarta",
  "Asia/Shanghai": "Beijing, Shanghai, Singapore",
  "Asia/Tokyo": "Tokyo, Seoul",
  "Australia/Sydney": "Sydney, Melbourne",
  "Pacific/Auckland": "Auckland, Wellington",
};

// Groups timezones by their current UTC offset (DST-aware, computed once at
// load) and collapses each group to a single representative option - what the
// user cares about is "what time will it be," not picking among a dozen
// obscure zones that currently share the same clock time.
const getTimeZoneGroups = (zones) => {
  const now = new Date();
  const offsetMinutes = (tz) => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value || "GMT+00:00";
      const m = parts.match(/GMT([+-])(\d{2}):(\d{2})/);
      if (!m) return 0;
      const sign = m[1] === "-" ? -1 : 1;
      return sign * (Number(m[2]) * 60 + Number(m[3]));
    } catch {
      return 0;
    }
  };

  const groups = new Map();
  for (const tz of zones) {
    const minutes = offsetMinutes(tz);
    if (!groups.has(minutes)) groups.set(minutes, []);
    groups.get(minutes).push(tz);
  }

  const formatOffset = (minutes) => {
    const sign = minutes < 0 ? "-" : "+";
    const abs = Math.abs(minutes);
    const h = String(Math.floor(abs / 60)).padStart(2, "0");
    const m = String(abs % 60).padStart(2, "0");
    return `UTC${sign}${h}:${m}`;
  };

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([minutes, tzs]) => {
      const representative = MAJOR_ZONES.find((z) => tzs.includes(z)) || tzs.sort()[0];
      const cities = CITY_LABELS[representative] || zoneCityLabel(representative);
      // UTC±HH:MM (City, City, ...) - e.g. "UTC-05:00 (New York, Miami, Toronto)"
      return { value: representative, label: `${formatOffset(minutes)} (${cities})` };
    });
};

const TIME_ZONE_GROUPS = getTimeZoneGroups(TIME_ZONE_OPTIONS);

// Default send time is a flat 9:30am in whatever timezone the user is in -
// not converted/anchored to any market's open. Set once (on creation, or
// backfilled the first time an older record is missing it) and persisted,
// so it never silently shifts if the user later changes their timezone.
const DEFAULT_SEND_HOUR = 9;
const DEFAULT_SEND_MINUTE = 30;

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
  const [tickerError, setTickerError] = useState("");
  const [tickersTouched, setTickersTouched] = useState(false);
  const [weeklyDay, setWeeklyDay] = useState("Monday");
  const [monthlyDay, setMonthlyDay] = useState(1);
  const [sendHour, setSendHour] = useState(DEFAULT_SEND_HOUR);
  const [sendMinute, setSendMinute] = useState(DEFAULT_SEND_MINUTE);
  const [timeZone, setTimeZone] = useState(getDefaultTimeZone());
  const [philosophySaved, setPhilosophySaved] = useState(false);
  const philosophyLoadedRef = useRef(false);

  const MAX_TICKERS = 5;

  // Autosave Philosophy on edit (debounced) - skips the very first set from
  // loadUserData so opening the page doesn't immediately re-save unchanged data.
  useEffect(() => {
    if (!airtableRecord) return;
    if (!philosophyLoadedRef.current) {
      philosophyLoadedRef.current = true;
      return;
    }
    const timeout = setTimeout(async () => {
      await airtableFetch(`${USERS_TABLE}/${airtableRecord.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { Philosophy: philosophy } }),
      });
      setPhilosophySaved(true);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [philosophy, airtableRecord]);

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
    philosophyLoadedRef.current = false;
    const data = await airtableFetch(
      `${USERS_TABLE}?filterByFormula=${encodeURIComponent(`{Email} = '${email}'`)}`
    );
    if (data.records && data.records.length > 0) {
      const record = data.records[0];
      const f = record.fields;
      setAirtableRecord(record);
      setPhilosophy(f.Philosophy || "");
      setTickers(f.Tickers || "");
      setTickersTouched(false);
      setSaved(true); // what's loaded is already the saved state
      setFrequency(f.Frequency || "Daily");
      setWeeklyDay(f.WeeklyDay || "Monday");
      setMonthlyDay(f.MonthlyDay ?? 1);
      setTimeZone(f.TimeZone || getDefaultTimeZone());

      if (f.SendHour == null || f.SendMinute == null) {
        // Older record predating this field - set the default once and
        // persist it immediately, so it's fixed from here on and never
        // recomputed (and thus never silently shifts) on a later login,
        // even if the user changes their timezone in between.
        setSendHour(DEFAULT_SEND_HOUR);
        setSendMinute(DEFAULT_SEND_MINUTE);
        await airtableFetch(`${USERS_TABLE}/${record.id}`, {
          method: "PATCH",
          body: JSON.stringify({ fields: { SendHour: DEFAULT_SEND_HOUR, SendMinute: DEFAULT_SEND_MINUTE } }),
        });
      } else {
        setSendHour(f.SendHour);
        setSendMinute(f.SendMinute);
      }
    } else {
      const tz = getDefaultTimeZone();
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
              WeeklyDay: "Monday",
              MonthlyDay: 1,
              SendHour: DEFAULT_SEND_HOUR,
              SendMinute: DEFAULT_SEND_MINUTE,
              TimeZone: tz,
            },
          }],
        }),
      });
      if (newRecord.records) {
        setAirtableRecord(newRecord.records[0]);
        setSaved(true); // freshly created with Tickers: "" - already saved
        setFrequency("Daily");
        setWeeklyDay("Monday");
        setMonthlyDay(1);
        setSendHour(DEFAULT_SEND_HOUR);
        setSendMinute(DEFAULT_SEND_MINUTE);
        setTimeZone(tz);
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

    // Only re-validate tickers if the user actually edited that field this
    // session - editing Philosophy/Frequency shouldn't get blocked by a
    // ticker that was valid when saved but has since been delisted.
    let tickersToSave = tickers;
    if (tickersTouched) {
      const { cleaned, invalid } = normalizeTickers(tickers);
      if (invalid.length > 0) {
        setTickerError(`Not a valid ticker: ${invalid.join(", ")}`);
        return;
      }
      if (cleaned.length > MAX_TICKERS) {
        setTickerError(`Max ${MAX_TICKERS} tickers allowed (you entered ${cleaned.length}).`);
        return;
      }
      tickersToSave = cleaned.join(", ");
      setTickers(tickersToSave);
    }

    setTickerError("");
    setSaving(true);
    await airtableFetch(`${USERS_TABLE}/${airtableRecord.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: { Tickers: tickersToSave },
      }),
    });
    setTickersTouched(false);
    setSaving(false);
    setSaved(true);
  };

  const handleFrequencyChange = async (newFreq) => {
    if (!airtableRecord) return;
    setFrequency(newFreq);
    await airtableFetch(`${USERS_TABLE}/${airtableRecord.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { Frequency: newFreq } }),
    });
  };

  const handleScheduleChange = async (fields) => {
    if (!airtableRecord) return;
    await airtableFetch(`${USERS_TABLE}/${airtableRecord.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });
  };

  const handleWeeklyDayChange = (day) => {
    setWeeklyDay(day);
    handleScheduleChange({ WeeklyDay: day });
  };

  const handleMonthlyDayChange = (day) => {
    setMonthlyDay(day);
    handleScheduleChange({ MonthlyDay: day });
  };

  const handleSendTimeChange = (hour, minute) => {
    setSendHour(hour);
    setSendMinute(minute);
    handleScheduleChange({ SendHour: hour, SendMinute: minute });
  };

  const handleTimeZoneChange = (tz) => {
    setTimeZone(tz);
    handleScheduleChange({ TimeZone: tz });
  };

  const handleLogin = async () => {
    try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setAirtableRecord(null);
    setPhilosophy("");
    setTickers("");
    setSaved(false);
    setTickersTouched(false);
    setFrequency("Daily");
    setBriefings([]);
    setWeeklyDay("Monday");
    setMonthlyDay(1);
    setSendHour(DEFAULT_SEND_HOUR);
    setSendMinute(DEFAULT_SEND_MINUTE);
    setTimeZone(getDefaultTimeZone());
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

            <div style={styles.labelRow}>
              <label style={{ ...styles.label, margin: 0 }}>Investment Philosophy</label>
              {philosophySaved && <span style={styles.autosaveHint}>✓ Saved</span>}
            </div>
            <textarea
              style={styles.textarea}
              value={philosophy}
              onChange={(e) => {
                setPhilosophy(e.target.value);
                setPhilosophySaved(false);
              }}
              placeholder={SAMPLE_PHILOSOPHY}
              rows={6}
            />
            <p style={styles.hint}>
              Not sure what to write?{" "}
              <button
                type="button"
                style={styles.linkBtn}
                onClick={() => {
                  setPhilosophy(SAMPLE_PHILOSOPHY);
                  setPhilosophySaved(false);
                }}
              >
                Use this example
              </button>
              {" "}- the more specific you are (metrics you care about, risk tolerance, time horizon), the more tailored your briefings will be.
            </p>

            <label style={styles.label}>Stock Tickers</label>
            <input
              style={styles.input}
              value={tickers}
              onChange={(e) => {
                setTickers(e.target.value);
                setTickersTouched(true);
                setSaved(false);
                if (tickerError) setTickerError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              placeholder="BRK.B, JPM, JNJ, GOOGL, KO"
            />
            <p style={styles.hint}>Comma-separated. Max {MAX_TICKERS} tickers. e.g. AAPL, MSFT, TSLA</p>
            {tickerError && <p style={styles.errorHint}>{tickerError}</p>}

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

            {frequency !== "Never" && (
              <>
                <label style={styles.label}>Send Time</label>
                <div style={styles.timeRow}>
                  {frequency === "Weekly" && (
                    <div style={{ ...styles.timeField, flex: 2 }}>
                      <label style={styles.subLabel}>Day</label>
                      <select
                        style={styles.selectInline}
                        value={weeklyDay}
                        onChange={(e) => handleWeeklyDayChange(e.target.value)}
                      >
                        {DAYS_OF_WEEK.map((day) => (
                          <option key={day} value={day}>{day}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {frequency === "Monthly" && (
                    <div style={{ ...styles.timeField, flex: 2 }}>
                      <label style={styles.subLabel}>Day</label>
                      <select
                        style={styles.selectInline}
                        value={monthlyDay}
                        onChange={(e) => handleMonthlyDayChange(Number(e.target.value))}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                          <option key={day} value={day}>{day}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div style={styles.timeField}>
                    <label style={styles.subLabel}>Hour</label>
                    <select
                      style={styles.selectInline}
                      value={sendHour}
                      onChange={(e) => handleSendTimeChange(Number(e.target.value), sendMinute)}
                    >
                      {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                        <option key={h} value={h}>{String(h).padStart(2, "0")}</option>
                      ))}
                    </select>
                  </div>
                  <div style={styles.timeField}>
                    <label style={styles.subLabel}>Min</label>
                    <select
                      style={styles.selectInline}
                      value={sendMinute}
                      onChange={(e) => handleSendTimeChange(sendHour, Number(e.target.value))}
                    >
                      {[0, 30].map((m) => (
                        <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ ...styles.timeField, flex: 3 }}>
                    <label style={styles.subLabel}>Zone</label>
                    <select
                      style={styles.selectInline}
                      value={timeZone}
                      onChange={(e) => handleTimeZoneChange(e.target.value)}
                    >
                      {!TIME_ZONE_GROUPS.some((group) => group.value === timeZone) && (
                        <option value={timeZone}>{timeZone}</option>
                      )}
                      {TIME_ZONE_GROUPS.map((group) => (
                        <option key={group.value} value={group.value}>{group.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p style={styles.hint}>Defaults to your device's time zone. Briefings send within 15 minutes of your chosen time.</p>
              </>
            )}
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
  linkBtn: { fontSize: 13, color: "#0066cc", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600, textDecoration: "underline" },
  tabs: { display: "flex", background: "#fff", borderBottom: "1px solid #e5e5e5", padding: "0 24px" },
  tab: { padding: "14px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#6e6e73", fontWeight: 500, borderBottom: "2px solid transparent" },
  tabActive: { padding: "14px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#0066cc", fontWeight: 600, borderBottom: "2px solid #0066cc" },
  main: { maxWidth: 720, margin: "32px auto", padding: "0 24px" },
  card: { background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" },
  sectionTitle: { fontSize: 20, fontWeight: 700, color: "#1d1d1f", margin: "0 0 8px" },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#1d1d1f", margin: "20px 0 6px" },
  labelRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "20px 0 6px" },
  autosaveHint: { fontSize: 12, color: "#1a8917", fontWeight: 600 },
  hint: { fontSize: 13, color: "#6e6e73", margin: "4px 0 0" },
  errorHint: { fontSize: 13, color: "#d70015", margin: "6px 0 0", fontWeight: 500 },
  textarea: { width: "100%", padding: "12px", borderRadius: 8, border: "1px solid #d2d2d7", fontSize: 14, lineHeight: 1.6, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", color: "#1d1d1f" },
  input: { width: "100%", padding: "12px", borderRadius: 8, border: "1px solid #d2d2d7", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", color: "#1d1d1f" },
  select: { width: "100%", padding: "12px", borderRadius: 8, border: "1px solid #d2d2d7", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", color: "#1d1d1f", background: "#fff" },
  timeRow: { display: "flex", gap: 10 },
  timeField: { flex: 1 },
  subLabel: { display: "block", fontSize: 12, color: "#6e6e73", margin: "0 0 4px" },
  selectInline: { width: "100%", padding: "12px", borderRadius: 8, border: "1px solid #d2d2d7", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", color: "#1d1d1f", background: "#fff" },
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
