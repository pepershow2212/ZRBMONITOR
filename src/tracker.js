import {
  fetchDirectServer,
  fetchGameServers,
  fetchPlayerSummaries,
  lobbyFromSummary,
} from "./steam.js";
import { joinToUrl, LobbyStore, toSteamJoinUrl } from "./lobbyStore.js";
import { fetchRconPlayers, queryRcon } from "./rcon.js";
import { getServer, SERVERS } from "./servers.js";
import { communityName, gameAppId } from "./flags.js";

const APP_ID = String(gameAppId());
const STEAM_API_KEY = process.env.STEAM_API_KEY || "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15_000);
const STALE_AFTER_MS = Number(process.env.STALE_AFTER_MS || 45_000);

const states = new Map(
  SERVERS.map((server) => [
    server.id,
    {
      extraSteamIds: new Set(),
      store: new LobbyStore({ staleAfterMs: STALE_AFTER_MS }),
      browser: null,
      rcon: null,
    },
  ])
);

export function getAppId() {
  return APP_ID;
}

function stateOf(serverId) {
  const server = getServer(serverId);
  return server ? states.get(server.id) : null;
}

export function watchedSteamIds(serverId) {
  const server = getServer(serverId);
  const state = stateOf(serverId);
  if (!server || !state) return [];
  return [...new Set([...server.seeds, ...state.extraSteamIds])];
}

export function allWatchedSteamIds() {
  return [...new Set(SERVERS.flatMap((server) => watchedSteamIds(server.id)))];
}

export function addSeed(serverId, steamId) {
  stateOf(serverId)?.extraSteamIds.add(steamId);
}

export function rememberLobby(serverId, entry) {
  const state = stateOf(serverId);
  if (!state) return false;
  if (entry.steamId && !String(entry.steamId).startsWith("manual-")) {
    state.extraSteamIds.add(entry.steamId);
  }
  state.store.upsert(entry);
  return true;
}

export function getLiveInfo(serverId) {
  const server = getServer(serverId);
  const state = stateOf(serverId);
  if (!server) return null;
  if (server.comingSoon) {
    return {
      status: "soon",
      players: 0,
      maxPlayers: 0,
      map: "",
    };
  }
  const live = state?.rcon || state?.browser;
  if (!live) {
    return {
      status:
        STEAM_API_KEY || server.addr || server.rconHost ? "offline" : "noconfig",
      players: 0,
      maxPlayers: 0,
      map: "",
    };
  }
  return {
    status: "online",
    players: Number(live.players || 0),
    maxPlayers: Number(live.maxPlayers || 0),
    map: live.map || "",
    found: live.name || live.map || "",
    mode: live.mode || "",
    lighting: live.lighting || "",
    zone: live.zone || "",
    scoreTick: Number(live.scoreTick || 0),
    scoreTickMax: Number(live.scoreTickMax || 0),
    factions: live.factions || [],
    top: live.top || [],
  };
}

export async function liveJoin(serverId) {
  const server = getServer(serverId);
  if (!server) return { ok: false, reason: "missing" };
  if (server.comingSoon) return { ok: false, reason: "soon", server };

  const live = getLiveInfo(server.id);
  let steamIds = [];

  if (server.rconHost && server.rconPassword) {
    try {
      const players = await fetchRconPlayers(server);
      steamIds = players
        .map((player) => String(player.steamId || ""))
        .filter((id) => /^7656119\d{10}$/.test(id));
      for (const steamId of steamIds) addSeed(server.id, steamId);
    } catch (error) {
      console.error(`Игроки ${server.name}:`, error.message);
    }
  }

  if (STEAM_API_KEY && steamIds.length) {
    const summaries = await fetchPlayerSummaries(STEAM_API_KEY, steamIds);
    for (const player of summaries) {
      const lobby = lobbyFromSummary(player, APP_ID);
      if (lobby?.lobbyId) {
        rememberLobby(server.id, lobby);
        return {
          ok: true,
          server,
          live,
          steamUrl: toSteamJoinUrl(lobby.appId, lobby.lobbyId, lobby.steamId),
        };
      }
    }
  }

  const cached = joinToUrl(pickJoin(server.id));
  if (cached) {
    return { ok: true, server, live, steamUrl: cached };
  }

  return {
    ok: false,
    reason: steamIds.length === 0 ? "empty" : "nolobby",
    server,
    live,
  };
}

export function pickJoin(serverId) {
  const state = stateOf(serverId);
  if (!state) return null;

  if (state.browser?.addr) {
    return {
      method: "connect",
      addr: state.browser.addr,
      name: state.browser.name,
    };
  }

  const lobby = state.store.pick(APP_ID);
  if (!lobby) return null;
  if (lobby.gameserverIp) {
    return {
      method: "connect",
      addr: lobby.gameserverIp,
      name: lobby.persona,
    };
  }
  if (!lobby.lobbyId) return null;
  return { method: "lobby", ...lobby };
}

export function status() {
  return {
    community: communityName(),
    appId: APP_ID,
    steamConfigured: Boolean(STEAM_API_KEY),
    servers: SERVERS.map((server) => {
      const join = pickJoin(server.id);
      const state = stateOf(server.id);
      return {
        id: server.id,
        name: server.name,
        query: server.query,
        ready: Boolean(joinToUrl(join)),
        method: join?.method || null,
        found: state.browser?.name || null,
        players: state.rcon?.players || state.browser?.players || 0,
        maxPlayers: state.rcon?.maxPlayers || state.browser?.maxPlayers || 0,
        map: state.rcon?.map || state.browser?.map || "",
        liveLobbies: state.store.snapshot().length,
        seeds: watchedSteamIds(server.id).length,
      };
    }),
  };
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchScore(serverName, query) {
  const name = normalizeName(serverName);
  const needle = normalizeName(query);
  if (!name || !needle) return 0;
  if (name === needle) return 1000 + needle.length;
  if (name.includes(needle)) return 100 + needle.length;

  const queryNum = needle.match(/#\s*(\d+)/)?.[1];
  const nameNum = name.match(/#\s*(\d+)/)?.[1];
  if (queryNum && nameNum && queryNum !== nameNum) return 0;

  const tokens = needle
    .split(/[^a-z0-9а-яё#]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && token !== "discord" && token !== "gg");
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((token) => name.includes(token)).length;
  if (hits === tokens.length) return 60 + hits;
  return 0;
}

function listingMatchesServer(listing, server) {
  const byName = matchScore(listing.name, server.query);
  if (byName) return byName;
  if (server.gameId && String(listing.name || "").includes(server.gameId)) return 90;
  if (server.gameId && String(listing.steamId || "").includes(server.gameId)) return 90;
  return 0;
}

function assignBrowserServers(listings) {
  const pairs = [];
  for (const server of SERVERS) {
    listings.forEach((listing, index) => {
      const score = listingMatchesServer(listing, server);
      if (score > 0) {
        pairs.push({ serverId: server.id, index, listing, score });
      }
    });
  }

  pairs.sort((a, b) => b.score - a.score);
  const usedServers = new Set();
  const usedListings = new Set();
  const assigned = new Map();

  for (const pair of pairs) {
    if (usedServers.has(pair.serverId) || usedListings.has(pair.index)) continue;
    usedServers.add(pair.serverId);
    usedListings.add(pair.index);
    assigned.set(pair.serverId, pair.listing);
  }
  return assigned;
}

async function refreshBrowser() {
  const listings = await fetchGameServers(STEAM_API_KEY, APP_ID);

  for (const server of SERVERS) {
    if (!server.addr) continue;
    const direct = await fetchDirectServer(server.addr);
    if (direct) listings.push({ ...direct, name: direct.name || server.query });
  }

  const assigned = assignBrowserServers(listings);
  for (const server of SERVERS) {
    const state = stateOf(server.id);
    state.browser = assigned.get(server.id) || null;
  }
}

async function refreshRcon() {
  for (const server of SERVERS) {
    const state = stateOf(server.id);
    if (!server.rconHost || !server.rconPassword) {
      state.rcon = null;
      continue;
    }
    try {
      const info = await queryRcon(server);
      const next = info
        ? {
            name: info.name || server.query,
            players: info.players,
            maxPlayers: info.maxPlayers,
            map: info.map,
            mode: info.mode,
            lighting: info.lighting,
            zone: info.zone,
            scoreTick: info.scoreTick,
            scoreTickMax: info.scoreTickMax,
            factions: info.factions,
            top: info.top,
          }
        : null;
      const fingerprint = next
        ? `${next.players}/${next.maxPlayers} ${next.map}`
        : "null";
      const changed = state.rconFingerprint !== fingerprint;
      state.rcon = next;
      state.rconFingerprint = fingerprint;
      if (info?.steamIds?.length) {
        for (const steamId of info.steamIds) addSeed(server.id, steamId);
      }
      if (changed && next) {
        console.log(`RCON ${server.name}: ${fingerprint}`);
      }
    } catch (error) {
      state.rcon = null;
      state.rconFingerprint = "err";
      console.error(`RCON ${server.name}:`, error.message);
    }
  }
}

async function refreshPlayers() {
  const steamIds = allWatchedSteamIds();
  if (steamIds.length === 0) return;

  const players = await fetchPlayerSummaries(STEAM_API_KEY, steamIds);

  for (const server of SERVERS) {
    const state = stateOf(server.id);
    const mine = new Set(watchedSteamIds(server.id));

    for (const player of players) {
      const steamId = String(player.steamid || "");
      if (!mine.has(steamId)) continue;

      const lobby = lobbyFromSummary(player, APP_ID);
      if (lobby) {
        state.store.upsert(lobby);
        if (!state.browser && lobby.gameserverIp) {
          state.browser = {
            name: lobby.persona,
            steamId: lobby.gameserverSteamId,
            addr: lobby.gameserverIp,
            players: 0,
            maxPlayers: 0,
            map: "",
          };
        }
      } else {
        state.store.remove(steamId);
      }
    }

    for (const steamId of mine) {
      if (!players.some((player) => player.steamid === steamId)) {
        state.store.remove(steamId);
      }
    }
  }
}

const liveListeners = [];

export function onLiveChange(fn) {
  liveListeners.push(fn);
}

function emitLiveChange() {
  for (const fn of liveListeners) {
    Promise.resolve()
      .then(() => fn())
      .catch((error) => {
        console.error("Обновление панели:", error.message);
      });
  }
}

export async function refreshLobbies() {
  await refreshRcon();
  if (STEAM_API_KEY) {
    await refreshPlayers();
  }
  emitLiveChange();
}

export function startPolling() {
  refreshLobbies().catch((error) => {
    console.error("Первый опрос не удался:", error.message);
  });

  setInterval(() => {
    refreshLobbies().catch((error) => {
      console.error("Опрос не удался:", error.message);
    });
  }, POLL_INTERVAL_MS);

  if (!STEAM_API_KEY) {
    console.log("STEAM_API_KEY пустой — кнопка Играть без живого лобби");
  }
}
