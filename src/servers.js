function parseIds(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function makeServer(id) {
  const key = String(id);
  return {
    id: key,
    name: process.env[`SERVER_${key}_NAME`] || `СЕРВЕР ${key}`,
    query:
      process.env[`SERVER_${key}_QUERY`] ||
      process.env[`SERVER_${key}_NAME`] ||
      `СЕРВЕР ${key}`,
    gameId: process.env[`SERVER_${key}_GAME_ID`] || "",
    comingSoon: process.env[`SERVER_${key}_SOON`] === "1",
    botToken: process.env[`SERVER_${key}_BOT_TOKEN`] || "",
    addr: process.env[`SERVER_${key}_ADDR`] || "",
    rconHost: process.env[`SERVER_${key}_RCON_HOST`] || "",
    rconPort: process.env[`SERVER_${key}_RCON_PORT`] || "",
    rconPassword: process.env[`SERVER_${key}_RCON_PASSWORD`] || "",
    seeds: parseIds(process.env[`SERVER_${key}_SEEDS`]),
  };
}

export const SERVERS = [1, 2, 3, 4].map(makeServer);

export function visibleServers() {
  return SERVERS.filter(
    (server) => server.rconHost || server.addr || server.comingSoon
  );
}

export function getServer(id) {
  const key = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/^server[-_\s]*/, "")
    .replace(/^сервер[-_\s]*/, "");
  return SERVERS.find((server) => server.id === key) || null;
}

export function serverChoices() {
  return visibleServers().map((server) => ({ name: server.name, value: server.id }));
}
