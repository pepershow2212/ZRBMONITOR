import { ActivityType, Client, GatewayIntentBits } from "discord.js";
import { SERVERS } from "./servers.js";
import { getLiveInfo } from "./tracker.js";

const GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS || 30_000);

function clip(value, max) {
  const text = String(value || "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function presenceOf(server, live) {
  if (!live || live.status === "soon") {
    return {
      nick: clip(server.name, 32),
      state: "Скоро",
      status: "idle",
    };
  }
  if (live.status === "noconfig") {
    return {
      nick: clip(server.name, 32),
      state: "Нет данных",
      status: "idle",
    };
  }
  if (live.status === "offline") {
    return {
      nick: clip(server.name, 32),
      state: "Оффлайн",
      status: "dnd",
    };
  }

  const online =
    live.maxPlayers > 0
      ? `${live.players}/${live.maxPlayers}`
      : String(live.players);
  const map = live.map || "карта?";

  return {
    nick: clip(server.name, 32),
    state: clip(`${online} · ${map}`, 128),
    status: "online",
  };
}

async function applyPresence(client, server) {
  const view = presenceOf(server, getLiveInfo(server.id));

  client.user.setPresence({
    status: view.status,
    activities: [
      {
        type: ActivityType.Custom,
        name: "Status",
        state: view.state,
      },
    ],
  });

  if (!GUILD_ID) return;
  const guild = await client.guilds.fetch(GUILD_ID);
  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (me.nickname !== view.nick) {
    await me.setNickname(view.nick);
  }
}

export async function startMonitors() {
  const started = [];

  for (const server of SERVERS) {
    if (!server.botToken) {
      console.log(`${server.name}: нет SERVER_${server.id}_BOT_TOKEN — монитор выключен`);
      continue;
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.on("ready", () => {
      console.log(`Монитор ${server.name}: ${client.user.tag}`);
      applyPresence(client, server).catch((error) => {
        console.error(`${server.name} монитор:`, error.message);
      });
    });

    await client.login(server.botToken);
    started.push({ server, client });
  }

  if (started.length === 0) return;

  setInterval(() => {
    for (const { server, client } of started) {
      applyPresence(client, server).catch((error) => {
        console.error(`${server.name} монитор:`, error.message);
      });
    }
  }, INTERVAL_MS);
}
