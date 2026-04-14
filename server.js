const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { fetchPurdueMenu, formatDateInTimezone } = require("./lib/purdueMenuClient");
const { buildDailyPlan, normalizeProfile } = require("./lib/planner");

const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3010);
const host = process.env.HOST || "127.0.0.1";

const demoProfile = normalizeProfile({
  name: "Boilermaker",
  goal: "lean-bulk",
  weightLb: 178,
  heightIn: 71,
  wakeTime: "07:30",
  sleepTime: "23:30",
  trainingLoad: "moderate",
  classBlocks: [
    { start: "08:30", end: "09:20", label: "Class" },
    { start: "10:30", end: "11:20", label: "Lab" },
    { start: "13:30", end: "14:20", label: "Lecture" }
  ],
  dietaryStyle: "high-protein omnivore",
  supplements: ["creatine", "vitamin-d", "omega-3", "magnesium"],
  caffeineCutoff: "16:00"
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(data);
  });
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "purdue-diet-optimizer" });
    return;
  }

  if (pathname === "/api/demo") {
    try {
      const menu = await fetchPurdueMenu({
        date: formatDateInTimezone(),
        courtName: "all-residential"
      });
      const plan = buildDailyPlan(demoProfile, menu);
      sendJson(res, 200, {
        profile: demoProfile,
        menu,
        plan
      });
    } catch (error) {
      sendJson(res, 502, {
        error: "Unable to load Purdue menu",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (pathname === "/api/plan" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const profile = normalizeProfile(body.profile || {});
      const menu = await fetchPurdueMenu(body.menuOptions || {});
      const plan = buildDailyPlan(profile, menu);
      sendJson(res, 200, { profile, menu, plan });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJson(res, detail.includes("Purdue") ? 502 : 400, {
        error: "Unable to build plan",
        detail
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname);
    return;
  }

  const targetPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, targetPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  sendFile(res, filePath);
});

server.listen(port, host, () => {
  console.log(`Purdue Diet Optimizer running at http://${host}:${port}`);
});
