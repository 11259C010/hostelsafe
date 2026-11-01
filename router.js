const express = require("express"), bcrypt = require("bcryptjs"), jwt = require("jsonwebtoken"),
  cookie = require("cookie-parser"), path = require("path"), db = require("./db");
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) throw new Error("Set JWT_SECRET (16+ random characters) in .env");
const ESC1 = +(process.env.ESC1_SEC || 120) * 1000, ESC2 = +(process.env.ESC2_SEC || 300) * 1000;
const router = express.Router();
router.use(express.json({ limit: "50kb" }));
router.use(cookie());

const s = (v, n = 200) => String(v == null ? "" : v).trim().slice(0, n);
const today = () => new Date().toLocaleDateString("en-CA");
const phones = k => (process.env[k] || "").split(",").map(x => x.trim()).filter(Boolean);
const log = (id, a) => db.prepare("INSERT INTO alert_log(alert_id,t,a) VALUES(?,?,?)").run(id, Date.now(), a);

// ---- simple per-IP rate limit (login/register) ----
const hits = new Map();
const limit = n => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 60000);
  if (a.length >= n) return res.status(429).json({ error: "Too many tries. Wait a minute." });
  a.push(now); hits.set(k, a); next();
};

// ---- auth ----
const setCookie = (res, u) => res.cookie("hs", jwt.sign({ id: u.id }, SECRET, { expiresIn: "30d" }),
  { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 864e5 });
const auth = role => (req, res, next) => {
  try {
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(jwt.verify(req.cookies.hs, SECRET).id);
    if (!u) throw 0;
    if (role && u.role !== role) return res.status(403).json({ error: "Not allowed" });
    req.u = u; next();
  } catch (e) { res.status(401).json({ error: "Please sign in" }); }
};

// ---- live updates to wardens (Server-Sent Events) ----
const clients = new Set();
const bc = () => clients.forEach(r => r.write("data: update\n\n"));
setInterval(() => clients.forEach(r => r.write(": ping\n\n")), 25000).unref();

// ---- SMS via Twilio (optional). Without keys it only logs to the console ----
async function notify(list, msg) {
  console.log("[NOTIFY]", list.join(",") || "(no numbers set)", "|", msg);
  const sid = process.env.TWILIO_SID, tok = process.env.TWILIO_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !tok || !from) return;
  for (const to of list) {
    try {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(sid + ":" + tok).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: from, Body: msg })
      });
    } catch (e) { console.error("SMS failed", to, e.message); }
  }
}

// ---- escalation: unanswered SOS climbs the chain automatically ----
setInterval(() => {
  const now = Date.now();
  db.prepare("SELECT * FROM alerts WHERE status='open'").all().forEach(a => {
    const age = now - a.t; let lv = a.esc;
    if (age >= ESC2 && a.esc < 3) lv = 3; else if (age >= ESC1 && a.esc < 2) lv = 2;
    if (lv !== a.esc) {
      db.prepare("UPDATE alerts SET esc=? WHERE id=?").run(lv, a.id);
      log(a.id, "Escalated to level " + lv);
      notify(phones(lv === 2 ? "CHIEF_PHONES" : "SECURITY_PHONES"), `UNANSWERED SOS (${Math.round(age / 60000)} min): ${a.name}, Room ${a.room}, ${a.floor}.`);
      bc();
    }
  });
}, 10000).unref();

// ================= ROUTES =================
router.post("/api/register", limit(20), (req, res) => {
  const b = req.body || {};
  if (process.env.REGISTER_CODE && s(b.code) !== process.env.REGISTER_CODE) return res.status(403).json({ error: "Wrong hostel code" });
  const name = s(b.name, 80), email = s(b.email, 120).toLowerCase(), room = s(b.room, 20), floor = s(b.floor, 30),
    year = b.year === "senior" ? "senior" : "first";
  if (!name || !room || !/^\S+@\S+\.\S+$/.test(email) || String(b.password || "").length < 8)
    return res.status(400).json({ error: "Fill all fields. Password needs 8+ characters." });
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) return res.status(409).json({ error: "Email already registered" });
  const id = db.prepare("INSERT INTO users(name,email,pass,role,room,floor,year) VALUES(?,?,?,?,?,?,?)")
    .run(name, email, bcrypt.hashSync(String(b.password), 10), "student", room, floor, year).lastInsertRowid;
  setCookie(res, { id }); res.json({ ok: true });
});
router.post("/api/login", limit(20), (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(s(req.body.email, 120).toLowerCase());
  if (!u || !bcrypt.compareSync(String(req.body.password || ""), u.pass)) return res.status(401).json({ error: "Wrong email or password" });
  setCookie(res, u); res.json({ ok: true });
});
router.post("/api/logout", (req, res) => { res.clearCookie("hs"); res.json({ ok: true }); });
router.get("/api/me", auth(), (req, res) => {
  const u = req.u;
  res.json({ id: u.id, name: u.name, role: u.role, room: u.room, floor: u.floor, year: u.year,
    checkedToday: !!db.prepare("SELECT 1 FROM checkins WHERE user_id=? AND date=?").get(u.id, today()) });
});

// ---- student actions ----
router.post("/api/alerts", auth("student"), (req, res) => {
  const u = req.u, loc = s(req.body.loc, 120);
  const id = db.prepare("INSERT INTO alerts(user_id,name,room,floor,year,loc,t) VALUES(?,?,?,?,?,?,?)")
    .run(u.id, u.name, u.room, u.floor, u.year, loc, Date.now()).lastInsertRowid;
  log(id, "SOS raised");
  notify(phones("WARDEN_PHONES"), `SOS: ${u.name}, Room ${u.room}, ${u.floor}${loc ? ", now at " + loc : ""}. Open the dashboard now.`);
  bc(); res.json({ ok: true, id });
});
router.post("/api/reports", auth("student"), (req, res) => {
  const b = req.body || {}, text = s(b.text, 3000);
  if (!text) return res.status(400).json({ error: "Describe what happened" });
  db.prepare("INSERT INTO reports(t,accused,room,when_txt,text) VALUES(?,?,?,?,?)").run(Date.now(), s(b.accused, 80), s(b.room, 20), s(b.when, 40), text);
  bc(); res.json({ ok: true });
});
router.post("/api/checkins", auth("student"), (req, res) => {
  const u = req.u, ok = req.body.ok ? 1 : 0;
  db.prepare("INSERT OR REPLACE INTO checkins(user_id,date,name,room,year,ok,t,done) VALUES(?,?,?,?,?,?,?,0)").run(u.id, today(), u.name, u.room, u.year, ok, Date.now());
  if (!ok) notify(phones("WARDEN_PHONES"), `Check-in: ${u.name} (Room ${u.room}) said they are NOT okay. Please arrange counselor follow-up.`);
  bc(); res.json({ ok: true });
});

// ---- warden actions ----
router.get("/api/stream", auth("warden"), (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders(); res.write("data: hello\n\n"); clients.add(res);
  req.on("close", () => clients.delete(res));
});
router.get("/api/all", auth("warden"), (req, res) => {
  const lg = db.prepare("SELECT t,a FROM alert_log WHERE alert_id=? ORDER BY t");
  res.json({
    alerts: db.prepare("SELECT * FROM alerts ORDER BY t DESC LIMIT 500").all().map(a => ({ id: a.id, name: a.name, room: a.room, floor: a.floor,
      loc: a.loc, t: a.t, status: a.status, ackT: a.ack_t, resT: a.res_t, note: a.note, esc: a.esc, log: lg.all(a.id) })),
    reports: db.prepare("SELECT * FROM reports ORDER BY t DESC LIMIT 500").all().map(r => ({ id: r.id, t: r.t, accused: r.accused, room: r.room, when: r.when_txt, text: r.text, status: r.status })),
    checkins: db.prepare("SELECT * FROM checkins ORDER BY t DESC LIMIT 1000").all().map(c => ({ id: c.user_id, name: c.name, room: c.room, year: c.year, ok: !!c.ok, date: c.date, t: c.t, done: !!c.done })),
    students: db.prepare("SELECT id,name,room,floor,year FROM users WHERE role='student'").all(),
    entries: db.prepare("SELECT id,name,floor,room,t FROM entries ORDER BY t DESC LIMIT 500").all()
  });
});
router.post("/api/alerts/:id/ack", auth("warden"), (req, res) => {
  const r = db.prepare("UPDATE alerts SET status='ack',ack_t=? WHERE id=? AND status='open'").run(Date.now(), +req.params.id);
  if (r.changes) log(+req.params.id, "Acknowledged by " + req.u.name);
  bc(); res.json({ ok: true });
});
router.post("/api/alerts/:id/resolve", auth("warden"), (req, res) => {
  const note = s(req.body.note, 500), now = Date.now();
  const r = db.prepare("UPDATE alerts SET status='resolved',res_t=?,ack_t=COALESCE(ack_t,?),note=? WHERE id=? AND status!='resolved'").run(now, now, note, +req.params.id);
  if (r.changes) log(+req.params.id, `Resolved by ${req.u.name}${note ? ": " + note : ""}`);
  bc(); res.json({ ok: true });
});
router.post("/api/reports/:id/review", auth("warden"), (req, res) => {
  db.prepare("UPDATE reports SET status='reviewed' WHERE id=?").run(+req.params.id); bc(); res.json({ ok: true });
});
router.post("/api/checkins/:uid/:date/done", auth("warden"), (req, res) => {
  db.prepare("UPDATE checkins SET done=1 WHERE user_id=? AND date=?").run(+req.params.uid, s(req.params.date, 10)); bc(); res.json({ ok: true });
});
router.post("/api/entries", auth("warden"), (req, res) => {
  const b = req.body || {};
  if (!s(b.name) || !s(b.room)) return res.status(400).json({ error: "Name and room needed" });
  db.prepare("INSERT INTO entries(name,floor,room,t,by_id) VALUES(?,?,?,?,?)").run(s(b.name, 80), s(b.floor, 30), s(b.room, 20), Date.now(), req.u.id);
  bc(); res.json({ ok: true });
});
router.get("/api/evidence.csv", auth("warden"), (req, res) => {
  const q = v => { v = String(v == null ? "" : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const f = t => t ? new Date(t).toISOString() : "";
  const rows = db.prepare("SELECT * FROM alerts ORDER BY t DESC").all().map(a => [f(a.t), a.name, a.room, a.floor, a.loc, f(a.ack_t),
    a.ack_t ? Math.round((a.ack_t - a.t) / 1000) : "", f(a.res_t), a.note, a.esc].map(q).join(","));
  res.set({ "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=ragging-evidence.csv" });
  res.send(["Raised,Student,Room,Floor,Location,Acknowledged,Response seconds,Resolved,Note,Escalation level"].concat(rows).join("\n"));
});

router.use(express.static(path.join(__dirname, "public")));
router.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Server error" }); });
module.exports = router;
