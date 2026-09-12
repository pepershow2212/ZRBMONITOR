import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { communityName } from "./flags.js";
import { joinMessage, panelFingerprint } from "./panel.js";
import { clearPanelRef, loadPanelRef, savePanelRef } from "./panelStore.js";
import { addSeed, getAppId, liveJoin, onLiveChange, rememberLobby } from "./tracker.js";
import { parseSteamJoinUrl } from "./lobbyStore.js";
import { getServer, serverChoices } from "./servers.js";
import { resolvePublicUrl } from "./web.js";

function joinReply(result) {
  if (!result || result.reason === "missing") {
    return { content: "Такого сервера нет." };
  }
  if (result.reason === "soon") {
    return { content: `**${result.server.name}** — скоро.` };
  }

  const site = resolvePublicUrl();
  if (site && result.server?.id) {
    return {
      content: "Жми — сайт сразу кинет в игру.",
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel("Играть")
            .setURL(`${site}/join?server=${encodeURIComponent(result.server.id)}`)
        ),
      ],
    };
  }

  if (result.ok && result.steamUrl) {
    const online =
      result.live?.maxPlayers > 0
        ? `${result.live.players}/${result.live.maxPlayers}`
        : "";
    const map = result.live?.map || "";
    return {
      content: [
        result.steamUrl,
        `**${result.server.name}** ${online} ${map}`.trim(),
        "Игра должна быть уже запущена.",
      ].join("\n"),
    };
  }
  return {
    content: [
      `**${result.server.name}** пустой — через лобби пока не зайти.`,
      `В игре ищите: **${result.server.query}**`,
    ].join("\n"),
  };
}

async function registerCommands(token, clientId, guildId) {
  const commands = [
    new SlashCommandBuilder()
      .setName("панель")
      .setDescription(`Живая панель серверов ${communityName()}`)
      .toJSON(),
    new SlashCommandBuilder()
      .setName("id")
      .setDescription("Вставить свежий steam://joinlobby после рестарта")
      .addStringOption((option) =>
        option
          .setName("сервер")
          .setDescription("Куда записать ID")
          .setRequired(true)
          .addChoices(...serverChoices())
      )
      .addStringOption((option) =>
        option
          .setName("ссылка")
          .setDescription("steam://joinlobby/APPID/LOBBYID/STEAMID")
          .setRequired(true)
      )
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(token);
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      return;
    }
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
  } catch (error) {
    console.error("Команды не зарегистрировались:", error.message);
    console.log("Пригласите основного бота на сервер с правами: applications.commands, Send Messages");
  }
}

export async function startBot() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.log("Discord бот выключен: нет DISCORD_TOKEN");
    return null;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let lastFingerprint = "";
  let refreshBusy = false;

  async function rememberPanel(message) {
    savePanelRef({ channelId: message.channelId, messageId: message.id });
    lastFingerprint = panelFingerprint();
  }

  async function fetchTrackedPanel() {
    const ref = loadPanelRef();
    if (!ref) return null;
    const channel = await client.channels.fetch(ref.channelId).catch(() => null);
    if (!channel?.isTextBased()) return null;
    return channel.messages.fetch(ref.messageId).catch(() => null);
  }

  async function refreshPanel(force = false) {
    if (!client.isReady() || refreshBusy) return;
    const fingerprint = panelFingerprint();
    if (!force && fingerprint === lastFingerprint) return;

    refreshBusy = true;
    try {
      const message = await fetchTrackedPanel();
      if (!message) {
        if (force) clearPanelRef();
        return;
      }
      await message.edit(joinMessage());
      lastFingerprint = fingerprint;
    } catch (error) {
      if (error.code === 10008) {
        clearPanelRef();
        lastFingerprint = "";
        return;
      }
      console.error("Панель не обновилась:", error.message);
    } finally {
      refreshBusy = false;
    }
  }

  client.on("ready", async () => {
    console.log(`Discord: ${client.user.tag}`);
    const clientId = client.application?.id || client.user.id;
    await registerCommands(token, clientId, process.env.DISCORD_GUILD_ID);
    const existing = await fetchTrackedPanel();
    if (existing) {
      await refreshPanel(true);
      return;
    }
    const channelId = process.env.DISCORD_CHANNEL_ID;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const sent = await channel.send(joinMessage());
    await rememberPanel(sent);
  });

  onLiveChange(() => {
    refreshPanel().catch((error) => {
      console.error("Панель не обновилась:", error.message);
    });
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith("join:")) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await liveJoin(interaction.customId.slice(5));
      await interaction.editReply(joinReply(result));
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "панель") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const previous = await fetchTrackedPanel();
      const sent = await interaction.channel.send(joinMessage());
      await rememberPanel(sent);
      if (previous && previous.id !== sent.id) {
        await previous.delete().catch(() => null);
      }
      await interaction.deleteReply().catch(() => null);
      return;
    }

    if (interaction.commandName === "id") {
      const server = getServer(interaction.options.getString("сервер"));
      const parsed = parseSteamJoinUrl(interaction.options.getString("ссылка"));
      if (!server || !parsed?.lobbyId || parsed.appId !== getAppId()) {
        await interaction.reply({
          ephemeral: true,
          content: `Нужны сервер и ссылка steam://joinlobby/${getAppId()}/LOBBYID/STEAMID`,
        });
        return;
      }
      if (parsed.steamId) addSeed(server.id, parsed.steamId);
      rememberLobby(server.id, {
        steamId: parsed.steamId || `manual-${parsed.lobbyId}`,
        lobbyId: parsed.lobbyId,
        appId: parsed.appId,
        persona: interaction.user.username,
      });
      await interaction.reply({
        ephemeral: true,
        content: `Новый ID записан на **${server.name}**. Кнопка снова кидает туда.`,
      });
    }
  });

  await client.login(token);
  return client;
}
