import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";
import { bannerUrl, communityName } from "./flags.js";
import { getLiveInfo } from "./tracker.js";
import { visibleServers } from "./servers.js";
import { resolvePublicUrl } from "./web.js";

const COMMUNITY = communityName();
const BANNER_URL = bannerUrl();

function publicUrl() {
  return resolvePublicUrl();
}

function buttonId(serverId) {
  return `join:${serverId}`;
}

function viewOf(server) {
  const live = getLiveInfo(server.id);
  const configured = Boolean(server.rconHost || server.addr || server.comingSoon);
  const soon = server.comingSoon || live?.status === "soon" || !configured;
  const online = !soon && live?.status === "online";
  const players = Number(live?.players || 0);
  const maxPlayers = Number(live?.maxPlayers || 0);
  const map = live?.map || "";

  if (soon) {
    return { server, soon: true, online: false, players, map, emoji: "🟡", line: "Скоро" };
  }
  if (!online) {
    return { server, soon: false, online: false, players, map, emoji: "🔴", line: "Оффлайн" };
  }

  const count = maxPlayers > 0 ? `${players}/${maxPlayers}` : String(players);
  return {
    server,
    soon: false,
    online: true,
    players,
    map,
    emoji: "🟢",
    line: map ? `\`${count}\`  ·  ${map}` : `\`${count}\``,
  };
}

function playButton(view) {
  if (view.soon) {
    return new ButtonBuilder()
      .setCustomId(buttonId(view.server.id))
      .setLabel("Скоро")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);
  }
  if (!view.online) {
    return new ButtonBuilder()
      .setCustomId(buttonId(view.server.id))
      .setLabel("Оффлайн")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);
  }

  const site = publicUrl();
  if (site) {
    return new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("Играть")
      .setURL(`${site}/join?server=${encodeURIComponent(view.server.id)}`);
  }
  return new ButtonBuilder()
    .setCustomId(buttonId(view.server.id))
    .setLabel("Играть")
    .setStyle(ButtonStyle.Success);
}

export function panelFingerprint() {
  return visibleServers()
    .map((server) => {
      const view = viewOf(server);
      return [server.id, view.soon ? "soon" : view.online ? "on" : "off", view.players, view.map, publicUrl()].join(":");
    })
    .join("|");
}

export function joinMessage() {
  const views = visibleServers().map(viewOf);
  const onlineNow = views.reduce((sum, view) => sum + (view.online ? view.players : 0), 0);

  const container = new ContainerBuilder().setAccentColor(0xb91c1c);

  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems((item) =>
      item.setURL(BANNER_URL).setDescription(COMMUNITY)
    )
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `# ${COMMUNITY}`,
        onlineNow > 0
          ? `Сейчас **${onlineNow}** в игре. Запусти игру и жми **Играть**.`
          : "Запусти игру и жми **Играть**.",
      ].join("\n")
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  for (const view of views) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**${view.emoji}  ${view.server.name}**\n${view.line}`
          )
        )
        .setButtonAccessory(playButton(view))
    );
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}
