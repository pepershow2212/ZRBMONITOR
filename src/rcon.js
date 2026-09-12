async function rconGet(server, path) {
  const url = `http://${server.rconHost}:${server.rconPort || 80}${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${server.rconPassword}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchRconPlayers(server) {
  if (!server.rconHost || !server.rconPassword) return [];
  const data = await rconGet(server, "/v1/players");
  return Array.isArray(data.players) ? data.players : [];
}

export async function queryRcon(server) {
  if (!server.rconHost || !server.rconPassword) return null;

  const [status, playersResult] = await Promise.all([
    rconGet(server, "/v1/status"),
    fetchRconPlayers(server)
      .then((players) => ({ ok: true, players }))
      .catch(() => ({ ok: false, players: [] })),
  ]);

  const list = playersResult.players;
  const steamIds = list
    .map((player) => String(player.steamId || ""))
    .filter((id) => /^7656119\d{10}$/.test(id));

  const byFaction = new Map();
  for (const player of list) {
    const faction = String(player.faction || "").trim();
    if (!faction) continue;
    byFaction.set(faction, (byFaction.get(faction) || 0) + 1);
  }

  return {
    name: status.serverName || server.query,
    map: status.map || "",
    mode: prettyMode(status.experiences?.[0]),
    lighting: prettyLighting(status.lighting),
    zone: prettyZone(status.alternator),
    scoreTick: Number(status.scoreTick?.current ?? 0),
    scoreTickMax: Number(status.scoreTick?.max ?? 0),
    players: playersResult.ok
      ? list.length
      : Number(status.players?.current ?? 0),
    maxPlayers: Number(status.players?.max ?? 0),
    factions: (status.factionScores || []).map((faction) => ({
      name: faction.name,
      score: Number(faction.score || 0),
      players: byFaction.get(faction.name) || 0,
    })),
    top: [...list]
      .sort(
        (a, b) =>
          Number(b.kills || 0) - Number(a.kills || 0) ||
          Number(b.cash || 0) - Number(a.cash || 0)
      )
      .filter((player) => Number(player.kills || 0) > 0)
      .slice(0, 3)
      .map((player) => ({
        name: String(player.name || "игрок"),
        kills: Number(player.kills || 0),
        deaths: Number(player.deaths || 0),
      })),
    steamIds,
  };
}

function prettyMode(experience) {
  const raw = String(experience || "");
  const match = raw.match(/koth|tdm|dm|frontline|conquest|atk|def/i);
  return match ? match[0].toUpperCase() : raw.replaceAll("_", " ");
}

function prettyLighting(value) {
  const known = {
    DayEarlyFog: "Утро, туман",
    DayFog: "День, туман",
    Day: "День",
    Night: "Ночь",
    NightFog: "Ночь, туман",
    Dusk: "Закат",
    Dawn: "Рассвет",
  };
  if (known[value]) return known[value];
  return String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function prettyZone(alternator) {
  return String(alternator || "").split(".")[2] || "";
}
