import express from "express";
import { joinPage, joinPayload, waitingPage } from "./pages.js";
import {
  addSeed,
  getAppId,
  liveJoin,
  rememberLobby,
  status,
} from "./tracker.js";
import { parseSteamJoinUrl, toSteamJoinUrl } from "./lobbyStore.js";
import { getServer } from "./servers.js";
import { communityName } from "./flags.js";

function normalizePublicUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const url = value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
  return url.replace(/\/$/, "");
}

function bothostUrlFromBotId() {
  const botId = String(process.env.BOT_ID || "").trim();
  if (!botId) return "";
  const slug = botId.replace(/^bot[-_]/i, "").replace(/_/g, "-");
  if (!slug) return "";
  return `https://bot-${slug}.bothost.tech`;
}

export function resolvePublicUrl() {
  const direct = normalizePublicUrl(process.env.PUBLIC_URL || process.env.DOMAIN);
  if (direct) return direct;

  const hook = String(process.env.WEBHOOK_URL || "");
  if (hook.startsWith("http")) {
    try {
      return new URL(hook).origin;
    } catch {
      /* ignore */
    }
  }

  return bothostUrlFromBotId();
}

export function createJoinApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((_req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/", (_req, res) => {
    res.redirect(302, "/join?server=1");
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get(["/api/status", "/api/wardogs/status"], (_req, res) => {
    res.json(status());
  });

  app.get(["/api/join-link", "/api/wardogs/join-link"], async (req, res) => {
    const server = getServer(req.query.server || req.query.name);
    if (!server) {
      res.status(404).json({ ok: false, reason: "missing" });
      return;
    }
    res.json(joinPayload(await liveJoin(server.id)));
  });

  app.get("/join", async (req, res) => {
    const server = getServer(req.query.server || req.query.name);
    if (!server) {
      res.status(404).type("html").send(waitingPage({ serverName: communityName() }));
      return;
    }
    res.status(200).type("html").send(joinPage(await liveJoin(server.id)));
  });

  app.post(["/api/report-link", "/api/wardogs/report-link"], (req, res) => {
    const server = getServer(req.body?.server);
    const parsed = parseSteamJoinUrl(req.body?.link);
    if (!server || !parsed?.lobbyId) {
      res.status(400).json({
        error: "Нужны server: 1|2|3|4 и ссылка steam://joinlobby/APPID/LOBBYID/STEAMID",
      });
      return;
    }
    if (parsed.appId !== getAppId()) {
      res.status(400).json({ error: `Ожидается appId ${getAppId()}` });
      return;
    }
    if (parsed.steamId) addSeed(server.id, parsed.steamId);
    rememberLobby(server.id, {
      steamId: parsed.steamId || `manual-${parsed.lobbyId}`,
      lobbyId: parsed.lobbyId,
      appId: parsed.appId,
      persona: req.body?.persona || "manual",
    });
    res.json({
      ok: true,
      server: server.name,
      link: toSteamJoinUrl(parsed.appId, parsed.lobbyId, parsed.steamId),
    });
  });

  return app;
}

export function startJoinServer() {
  const port = Number(process.env.PORT || 3000);
  const app = createJoinApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "0.0.0.0", () => {
      const publicUrl = resolvePublicUrl();
      if (publicUrl) process.env.PUBLIC_URL = publicUrl;
      console.log(
        `Join слушает 0.0.0.0:${port} DOMAIN=${process.env.DOMAIN || "-"} BOT_ID=${process.env.BOT_ID || "-"} PUBLIC=${publicUrl || "-"}`
      );
      resolve(server);
    });
    server.on("error", reject);
  });
}
