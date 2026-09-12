import json
import os
from pathlib import Path

import discord
from discord import app_commands
from discord.ext import commands

from zaruba.config import banner_url, community_name, public_url
from zaruba.servers import get_server, visible_servers
from zaruba.tracker import (
    APP_ID,
    add_seed,
    get_live_info,
    live_join,
    on_live_change,
    parse_steam_join,
    remember_lobby,
)

PANEL_FILE = Path(os.getenv("DATA_DIR") or Path.cwd() / "data") / "panel.json"


def _view_of(server):
    live = get_live_info(server)
    soon = server["coming_soon"] or live["status"] == "soon" or live["status"] == "noconfig"
    online = not soon and live["status"] == "online"
    players = live["players"]
    max_players = live["maxPlayers"]
    count = f"{players}/{max_players}" if max_players else str(players)
    if soon:
        return {"server": server, "soon": True, "online": False, "line": "Скоро", "emoji": "🟡"}
    if not online:
        return {"server": server, "soon": False, "online": False, "line": "Оффлайн", "emoji": "🔴"}
    map_name = live.get("map") or ""
    return {
        "server": server,
        "soon": False,
        "online": True,
        "line": f"`{count}`  ·  {map_name}" if map_name else f"`{count}`",
        "emoji": "🟢",
        "players": players,
        "map": map_name,
    }


def panel_embed():
    views = [_view_of(server) for server in visible_servers()]
    online_now = sum(view.get("players") or 0 for view in views if view["online"])
    name = community_name()
    embed = discord.Embed(
        title=name,
        description=(
            f"Сейчас **{online_now}** в игре. Запусти игру и жми **Играть**."
            if online_now
            else "Запусти игру и жми **Играть**."
        ),
        color=0xB91C1C,
    )
    embed.set_image(url=banner_url())
    for view in views:
        embed.add_field(
            name=f"{view['emoji']}  {view['server']['name']}",
            value=view["line"],
            inline=False,
        )
    return embed


def panel_view():
    site = public_url()
    view = discord.ui.View(timeout=None)
    for item in [_view_of(server) for server in visible_servers()]:
        if item["soon"]:
            view.add_item(discord.ui.Button(label="Скоро", style=discord.ButtonStyle.secondary, disabled=True))
        elif not item["online"]:
            view.add_item(discord.ui.Button(label="Оффлайн", style=discord.ButtonStyle.secondary, disabled=True))
        elif site:
            view.add_item(
                discord.ui.Button(
                    label="Играть",
                    style=discord.ButtonStyle.link,
                    url=f"{site}/join?server={item['server']['id']}",
                )
            )
        else:
            view.add_item(
                discord.ui.Button(
                    label="Играть",
                    style=discord.ButtonStyle.success,
                    custom_id=f"join:{item['server']['id']}",
                )
            )
    return view


def _load_panel():
    try:
        data = json.loads(PANEL_FILE.read_text(encoding="utf-8"))
        if data.get("channelId") and data.get("messageId"):
            return data
    except Exception:
        pass
    return None


def _save_panel(channel_id, message_id):
    PANEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    PANEL_FILE.write_text(
        json.dumps({"channelId": str(channel_id), "messageId": str(message_id)}, indent=2),
        encoding="utf-8",
    )


class PanelBot(commands.Bot):
    def __init__(self, session):
        super().__init__(command_prefix="!", intents=discord.Intents.default())
        self.session = session
        self.busy = False

        @self.tree.command(name="панель", description=f"Живая панель серверов {community_name()}")
        async def panel_cmd(interaction: discord.Interaction):
            await interaction.response.defer(ephemeral=True)
            await self._post_panel(interaction.channel)
            await interaction.delete_original_response()

        @self.tree.command(name="id", description="Вставить steam://joinlobby")
        @app_commands.describe(сервер="Номер сервера", ссылка="steam://joinlobby/...")
        async def id_cmd(interaction: discord.Interaction, сервер: str, ссылка: str):
            server = get_server(сервер)
            parsed = parse_steam_join(ссылка)
            if not server or not parsed or parsed["appId"] != APP_ID:
                await interaction.response.send_message(
                    f"Нужны сервер и ссылка steam://joinlobby/{APP_ID}/LOBBYID/STEAMID",
                    ephemeral=True,
                )
                return
            if parsed.get("steamId"):
                add_seed(server["id"], parsed["steamId"])
            remember_lobby(server["id"], parsed)
            await interaction.response.send_message(
                f"Новый ID записан на **{server['name']}**.",
                ephemeral=True,
            )

    async def setup_hook(self):
        self.add_view(panel_view())
        guild_id = os.getenv("DISCORD_GUILD_ID")
        if guild_id:
            await self.tree.sync(guild=discord.Object(id=int(guild_id)))
        else:
            await self.tree.sync()
        on_live_change(self.refresh_panel)

    async def on_ready(self):
        print(f"Discord: {self.user}")
        ref = _load_panel()
        if ref:
            await self.refresh_panel(force=True)
            return
        channel_id = os.getenv("DISCORD_CHANNEL_ID")
        if not channel_id:
            return
        channel = self.get_channel(int(channel_id)) or await self.fetch_channel(int(channel_id))
        await self._post_panel(channel)

    async def _post_panel(self, channel):
        previous = None
        ref = _load_panel()
        if ref:
            try:
                old = self.get_channel(int(ref["channelId"])) or await self.fetch_channel(int(ref["channelId"]))
                previous = await old.fetch_message(int(ref["messageId"]))
            except Exception:
                previous = None
        sent = await channel.send(embed=panel_embed(), view=panel_view())
        _save_panel(sent.channel.id, sent.id)
        if previous and previous.id != sent.id:
            try:
                await previous.delete()
            except Exception:
                pass

    async def refresh_panel(self, force=False):
        if self.busy or not self.is_ready():
            return
        ref = _load_panel()
        if not ref:
            return
        self.busy = True
        try:
            channel = self.get_channel(int(ref["channelId"])) or await self.fetch_channel(int(ref["channelId"]))
            message = await channel.fetch_message(int(ref["messageId"]))
            await message.edit(embed=panel_embed(), view=panel_view())
        except discord.NotFound:
            PANEL_FILE.write_text("{}", encoding="utf-8")
        except Exception as error:
            print("Панель не обновилась:", error)
        finally:
            self.busy = False

    async def on_interaction(self, interaction: discord.Interaction):
        custom = ""
        if interaction.type is discord.InteractionType.component:
            custom = (interaction.data or {}).get("custom_id") or ""
        if custom.startswith("join:"):
            await interaction.response.defer(ephemeral=True)
            server = get_server(custom.split(":", 1)[1])
            result = await live_join(self.session, server)
            site = public_url()
            if site and server:
                view = discord.ui.View()
                view.add_item(
                    discord.ui.Button(
                        label="Играть",
                        style=discord.ButtonStyle.link,
                        url=f"{site}/join?server={server['id']}",
                    )
                )
                await interaction.followup.send("Жми — сайт сразу кинет в игру.", view=view, ephemeral=True)
                return
            if result.get("ok") and result.get("steamUrl"):
                await interaction.followup.send(result["steamUrl"], ephemeral=True)
                return
            await interaction.followup.send(
                f"**{server['name']}** пустой — в игре ищите: **{server['query']}**",
                ephemeral=True,
            )
            return
        await self.process_app_commands(interaction)


class MonitorBot(discord.Client):
    def __init__(self, server):
        super().__init__(intents=discord.Intents.default())
        self.server = server

    async def on_ready(self):
        print(f"Монитор {self.server['name']}: {self.user}")
        await self.apply()

    async def apply(self):
        live = get_live_info(self.server)
        if live["status"] == "soon" or live["status"] == "noconfig":
            nick, state, status = self.server["name"], "Скоро" if live["status"] == "soon" else "Нет данных", discord.Status.idle
        elif live["status"] != "online":
            nick, state, status = self.server["name"], "Оффлайн", discord.Status.dnd
        else:
            count = f"{live['players']}/{live['maxPlayers']}" if live["maxPlayers"] else str(live["players"])
            nick, state, status = self.server["name"], f"{count} · {live['map'] or 'карта?'}", discord.Status.online
        await self.change_presence(
            status=status,
            activity=discord.CustomActivity(name=state[:128]),
        )
        guild_id = os.getenv("DISCORD_GUILD_ID")
        if not guild_id:
            return
        guild = self.get_guild(int(guild_id)) or await self.fetch_guild(int(guild_id))
        me = guild.me or await guild.fetch_member(self.user.id)
        if me.nick != nick[:32]:
            try:
                await me.edit(nick=nick[:32])
            except Exception as error:
                print(f"{self.server['name']} ник:", error)


async def start_panel(session):
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        print("Панель не стартанула: нет DISCORD_TOKEN")
        return None
    bot = PanelBot(session)
    await bot.start(token)
    return bot


async def start_monitors(servers):
    import asyncio

    started = []
    for server in servers:
        token = server["bot_token"]
        if not token:
            print(f"{server['name']}: нет SERVER_{server['id']}_BOT_TOKEN — монитор выключен")
            continue
        bot = MonitorBot(server)
        started.append(bot)
        asyncio.create_task(bot.start(token), name=f"monitor-{server['id']}")

    if not started:
        return []

    interval = int(os.getenv("MONITOR_INTERVAL_MS") or 30000) / 1000

    async def loop():
        while True:
            await asyncio.sleep(interval)
            for bot in started:
                if bot.is_ready():
                    try:
                        await bot.apply()
                    except Exception as error:
                        print(f"{bot.server['name']} монитор:", error)

    asyncio.create_task(loop(), name="monitor-loop")
    return started
