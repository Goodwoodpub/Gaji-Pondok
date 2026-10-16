// Gaji Harian Pondok — server Express + Postgres (atau file JSON saat lokal).
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const OWNER_PIN = process.env.OWNER_PIN || "5678";
const ADMIN_NAME = process.env.ADMIN_NAME || "Kak Umar";
const OWNER_NAME = process.env.OWNER_NAME || "Pemilik";
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) console.warn("SESSION_SECRET belum diisi: login akan hilang setiap server restart.");
if (!process.env.ADMIN_PIN || !process.env.OWNER_PIN) console.warn("ADMIN_PIN/OWNER_PIN belum diisi: memakai PIN bawaan 1234/5678. Segera ganti di Railway.");

const DEFAULT_WORKERS = [
  { id: "ipin", name: "Mas Ipin", rate: 100000, active: true },
  { id: "alung", name: "Pak De Alung", rate: 90000, active: true },
  { id: "ijal", name: "Ijal", rate: 85000, active: true },
  { id: "sugeng", name: "Pak Sugeng", rate: 85000, active: true },
];

/* ---------------- penyimpanan ---------------- */
let store;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  const local = /localhost|127\.0\.0\.1|\.railway\.internal/.test(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
  store = {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    },
    async all() {
      const r = await pool.query("SELECT k, v FROM kv");
      return Object.fromEntries(r.rows.map((x) => [x.k, x.v]));
    },
    async get(k) {
      const r = await pool.query("SELECT v FROM kv WHERE k=$1", [k]);
      return r.rows[0] ? r.rows[0].v : null;
    },
    async set(k, v) {
      await pool.query(
        "INSERT INTO kv (k, v, updated_at) VALUES ($1, $2, now()) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v, updated_at=now()",
        [k, JSON.stringify(v)]
      );
    },
  };
} else {
  const file = process.env.DATA_FILE || path.join(__dirname, "data.json");
  let mem = {};
  const save = () => fs.writeFileSync(file, JSON.stringify(mem, null, 1));
  store = {
    async init() { if (fs.existsSync(file)) mem = JSON.parse(fs.readFileSync(file, "utf8")); console.warn("DATABASE_URL tidak ada: data disimpan di " + file); },
    async all() { return JSON.parse(JSON.stringify(mem)); },
    async get(k) { return mem[k] ? JSON.parse(JSON.stringify(mem[k])) : null; },
    async set(k, v) { mem[k] = v; save(); },
  };
}

// Kunci per dokumen agar dua simpan bersamaan tidak saling timpa.
const locks = new Map();
async function withLock(k, fn) {
  const prev = locks.get(k) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(k, prev.then(() => next));
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(k) === next) locks.delete(k); }
}

/* ---------------- sesi ---------------- */
function sign(v) { return crypto.createHmac("sha256", SECRET).update(v).digest("base64url"); }
function makeToken(role) {
  const body = Buffer.from(JSON.stringify({ role, exp: Date.now() + 1000 * 60 * 60 * 24 * 90 })).toString("base64url");
  return body + "." + sign(body);
}
function readToken(t) {
  if (!t || !t.includes(".")) return null;
  const [body, sig] = t.split(".");
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)).filter((x) => x[0]));
}
const nameOf = (role) => (role === "admin" ? ADMIN_NAME : OWNER_NAME);
function pinEq(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/* ---------------- aplikasi ---------------- */
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));

app.use((req, res, next) => {
  const s = readToken(cookies(req).gp_sesi);
  req.role = s ? s.role : null;
  next();
});
const need = (...roles) => (req, res, next) =>
  roles.includes(req.role) ? next() : res.status(req.role ? 403 : 401).json({ error: req.role ? "Tidak punya izin" : "Silakan masuk dulu" });

// Pembatas percobaan PIN sederhana
const tries = new Map();
app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const t = tries.get(ip) || { n: 0, until: 0 };
  if (t.until > Date.now()) return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi 5 menit lagi." });
  const pin = String((req.body && req.body.pin) || "");
  let role = null;
  if (pinEq(pin, ADMIN_PIN)) role = "admin";
  else if (pinEq(pin, OWNER_PIN)) role = "owner";
  if (!role) {
    t.n++; if (t.n >= 8) { t.until = Date.now() + 5 * 60 * 1000; t.n = 0; }
    tries.set(ip, t);
    return res.status(401).json({ error: "PIN salah" });
  }
  tries.delete(ip);
  res.setHeader("Set-Cookie", `gp_sesi=${makeToken(role)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${req.secure ? "; Secure" : ""}`);
  res.json({ role, name: nameOf(role) });
});
app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "gp_sesi=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/state", need("admin", "owner"), async (req, res, next) => {
  try {
    const all = await store.all();
    const absen = {}, bayar = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith("absen:")) absen[k.slice(6)] = v;
      else if (k.startsWith("bayar:")) bayar[k.slice(6)] = v;
    }
    const cfg = all.config || { workers: DEFAULT_WORKERS };
    res.json({ role: req.role, name: nameOf(req.role), workers: cfg.workers, absen, bayar });
  } catch (e) { next(e); }
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (x) => Math.max(0, Math.round(Number(x) || 0));

app.put("/api/absen/:date", need("admin"), async (req, res, next) => {
  const { date } = req.params;
  const { id, patch } = req.body || {};
  if (!DATE.test(date) || typeof id !== "string" || !patch || typeof patch !== "object") return res.status(400).json({ error: "Data tidak lengkap" });
  try {
    const doc = await withLock("absen:" + date, async () => {
      const d = (await store.get("absen:" + date)) || { date, entries: {} };
      const e = Object.assign({ v: 0, lembur: 0, kasbon: 0 }, d.entries[id]);
      if ("v" in patch) e.v = [0, 0.5, 1].includes(Number(patch.v)) ? Number(patch.v) : 0;
      if ("lembur" in patch) e.lembur = num(patch.lembur);
      if ("kasbon" in patch) e.kasbon = num(patch.kasbon);
      e.by = nameOf(req.role); e.at = new Date().toISOString();
      d.entries[id] = e;
      await store.set("absen:" + date, d);
      return d;
    });
    res.json(doc);
  } catch (e) { next(e); }
});

app.put("/api/bayar/:key", need("admin", "owner"), async (req, res, next) => {
  const { key } = req.params;
  const [from, to] = key.split("_");
  const { id, paid, amount } = req.body || {};
  if (!DATE.test(from || "") || !DATE.test(to || "") || typeof id !== "string") return res.status(400).json({ error: "Data tidak lengkap" });
  try {
    const doc = await withLock("bayar:" + key, async () => {
      const d = (await store.get("bayar:" + key)) || { from, to, workers: {} };
      d.workers[id] = paid ? { paid: true, amount: num(amount), at: new Date().toISOString(), by: nameOf(req.role) } : { paid: false };
      await store.set("bayar:" + key, d);
      return d;
    });
    res.json(doc);
  } catch (e) { next(e); }
});

app.put("/api/workers", need("admin"), async (req, res, next) => {
  const list = (req.body && req.body.workers) || [];
  if (!Array.isArray(list)) return res.status(400).json({ error: "Data tidak valid" });
  const clean = list
    .filter((w) => w && typeof w.id === "string" && String(w.name || "").trim())
    .map((w) => ({ id: w.id.slice(0, 40), name: String(w.name).trim().slice(0, 60), rate: num(w.rate), active: w.active !== false }));
  try { await store.set("config", { workers: clean }); res.json({ workers: clean }); } catch (e) { next(e); }
});

app.get("/healthz", (req, res) => res.send("ok"));
// File tampilan boleh di folder public/ atau langsung di folder utama.
const PUB = fs.existsSync(path.join(__dirname, "public", "index.html")) ? path.join(__dirname, "public") : __dirname;
const STATIC = { "/": "index.html", "/index.html": "index.html", "/icon.svg": "icon.svg", "/manifest.webmanifest": "manifest.webmanifest" };
app.get(Object.keys(STATIC), (req, res) => {
  const f = STATIC[req.path];
  if (f === "manifest.webmanifest") res.type("application/manifest+json");
  res.set("Cache-Control", f === "index.html" ? "no-cache" : "public, max-age=3600");
  res.sendFile(path.join(PUB, f));
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Server bermasalah, coba lagi" }); });

store.init().then(() => app.listen(PORT, () => console.log("Gaji Pondok jalan di port " + PORT))).catch((e) => { console.error("Gagal konek database:", e); process.exit(1); });
