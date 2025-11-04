// MCP-brygga: exponerar manifest + ett enda tool "calender".
// När AgentKit kör verktyget POST:ar vi vidare till n8n (N8N_CALENDER_URL).
// Node 18+ (har fetch). Valfritt auth via MCP_KEY.

import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---- basic cache off ----
app.set("etag", false);
function noCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

const PORT = process.env.PORT || 3000;
const MCP_KEY = process.env.MCP_KEY || ""; // valfritt
const N8N_CALENDER_URL = process.env.N8N_CALENDER_URL; // din n8n MCP/webhook-URL

if (!N8N_CALENDER_URL) {
  console.error("❌ Missing env N8N_CALENDER_URL");
  process.exit(1);
}

// ---- enkel auth (valfri) ----
function checkAuth(req, res) {
  if (!MCP_KEY) return true;
  const auth = req.headers.authorization || "";
  const ok = auth.startsWith("Bearer ") && auth.slice(7) === MCP_KEY;
  if (!ok) res.status(401).json({ ok: false, error: "Unauthorized" });
  return ok;
}

// ---- manifest ----
// OBS: tool-namnet är exakt "calender" (med e) eftersom du valt den stavningen.
const MANIFEST = {
  tools: [
    {
      name: "calender",
      description:
        "Skapa/hantera kalenderhändelser via n8n. Skicka eventfält i 'data'.",
      input_schema: {
        type: "object",
        properties: {
          // fält du vill stödja – n8n mappas efter behov
          title: { type: "string" },
          start: { type: "string", description: "ISO start" },
          end: { type: "string", description: "ISO end" },
          timezone: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          attendees: { type: "array", items: { type: "string" } },
          // fria extra-fält
          data: { type: "object", additionalProperties: true }
        },
        // sätt det du kräver
        required: ["title", "start", "end"]
      }
    }
  ]
};

// ---- helpers ----
function getBody(req) {
  // AgentKit/MCP kan skicka både { params: {...} } eller rå body
  const raw = req.body?.params ?? req.body ?? {};
  return raw;
}
async function tryJson(text) { try { return JSON.parse(text); } catch { return { raw: text }; } }

// ---- routes ----
app.get("/", (_req, res) => res.send("MCP up"));
app.get("/mcp/manifest", (_req, res) => { noCache(res); res.json(MANIFEST); });
app.post("/mcp/manifest", (_req, res) => { noCache(res); res.json(MANIFEST); });

app.get("/mcp/tools", (_req, res) => {
  noCache(res);
  res.json({ tools: MANIFEST.tools.map(t => t.name) });
});
app.get("/mcp/tools/full", (_req, res) => { noCache(res); res.json({ tools: MANIFEST.tools }); });

// skydda alla tool-calls om MCP_KEY finns
app.use((req, res, next) => {
  if (["/", "/mcp/manifest", "/mcp/tools", "/mcp/tools/full"].includes(req.path)) return next();
  if (!checkAuth(req, res)) return;
  next();
});

// ---- enda verktyget: calender ----
app.post("/mcp/tools/calender", async (req, res) => {
  try {
    const payload = getBody(req);   // förväntar t.ex. { title, start, end, ... }
    // skicka vidare 1:1 till n8n (du mappar inne i n8n)
    const r = await fetch(N8N_CALENDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    const json = await tryJson(text);
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, response: json });
  } catch (e) {
    console.error("[calender] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ MCP running on :${PORT}`);
  console.log(`↪ forwarding to n8n: ${N8N_CALENDER_URL}`);
  if (MCP_KEY) console.log("🔒 Auth enabled (Bearer)");
});
