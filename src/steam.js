import { createRequire } from "module";
import { communityName } from "./flags.js";

const require = createRequire(import.meta.url);
const { queryGameServerInfo, queryMasterServer, REGIONS } = require("steam-server-query");

const SUMMARIES_URL =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function fetchPlayerSummaries(apiKey, steamIds) {
  const unique = [...new Set(steamIds.filter(Boolean))];
  if (!apiKey || unique.length === 0) return [];

  const players = [];
  for (const group of chunk(unique, 100)) {
    const url = new URL(SUMMARIES_URL);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamids", group.join(","));

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Steam API ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    players.push(...(data?.response?.players ?? []));
  }
  return players;
}

export function lobbyFromSummary(player, expectedAppId) {
  if (!player?.steamid) return null;
  if (expectedAppId && String(player.gameid) !== String(expectedAppId)) {
    return null;
  }

  const gameserverIp =
    player.gameserverip && player.gameserverip !== "0.0.0.0:0"
      ? String(player.gameserverip)
      : "";

  if (!player.lobbysteamid && !gameserverIp && !player.gameserversteamid) {
    return null;
  }

  return {
    steamId: String(player.steamid),
    lobbyId: player.lobbysteamid ? String(player.lobbysteamid) : "",
    appId: String(player.gameid || expectedAppId || ""),
    persona: player.personaname || "",
    gameserverSteamId: player.gameserversteamid
      ? String(player.gameserversteamid)
      : "",
    gameserverIp,
  };
}

function toListing(server) {
  const [host] = String(server.addr || "").split(":");
  const port = server.gameport || String(server.addr || "").split(":")[1];
  return {
    name: String(server.name || ""),
    steamId: server.steamid ? String(server.steamid) : "",
    addr: host && port ? `${host}:${port}` : String(server.addr || ""),
    players: Number(server.players || 0),
    maxPlayers: Number(server.max_players || 0),
    map: String(server.map || ""),
  };
}

async function fetchFromWebApi(apiKey, appId) {
  if (!apiKey) return [];

  const url = new URL(
    "https://api.steampowered.com/IGameServersService/GetServerList/v1/"
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("limit", "5000");
  url.searchParams.set("filter", `\\appid\\${appId}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Steam servers ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return (data?.response?.servers ?? []).map(toListing);
}

async function infoFromHost(host) {
  const info = await queryGameServerInfo(host, 2, 2500);
  return {
    name: String(info.name || ""),
    steamId: info.serverId ? String(info.serverId) : "",
    addr: info.port ? `${String(host).split(":")[0]}:${info.port}` : host,
    players: Number(info.players || 0),
    maxPlayers: Number(info.maxPlayers || 0),
    map: String(info.map || ""),
  };
}

async function fetchFromMaster(appId) {
  const needle = process.env.STEAM_NAME_MATCH || `*${communityName()}*`;
  const hosts = await queryMasterServer(
    "hl2master.steampowered.com:27011",
    REGIONS.ALL,
    { appid: Number(appId), name_match: needle },
    8000,
    150
  );

  const listings = [];
  for (const host of hosts) {
    try {
      listings.push(await infoFromHost(host));
    } catch {
      listings.push({
        name: "",
        steamId: "",
        addr: host,
        players: 0,
        maxPlayers: 0,
        map: "",
      });
    }
  }
  return listings;
}

export async function fetchDirectServer(addr) {
  if (!addr) return null;
  try {
    return await infoFromHost(addr);
  } catch {
    return null;
  }
}

export async function fetchGameServers(apiKey, appId) {
  const listings = [];
  const seen = new Set();

  const pushAll = (items) => {
    for (const item of items) {
      const key = `${item.addr}|${item.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      listings.push(item);
    }
  };

  if (apiKey) {
    pushAll(await fetchFromWebApi(apiKey, appId));
  }

  try {
    pushAll(await fetchFromMaster(appId));
  } catch (error) {
    console.error("Steam master не ответил:", error.message);
  }

  return listings;
}
