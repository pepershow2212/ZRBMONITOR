import asyncio
import os
import re
import time

import aiohttp

from zaruba.config import community_name, game_app_id

APP_ID = game_app_id()
STEAM_KEY = os.getenv("STEAM_API_KEY") or ""
POLL_SEC = int(os.getenv("POLL_INTERVAL_MS") or 15000) / 1000
STALE_SEC = int(os.getenv("STALE_AFTER_MS") or 45000) / 1000

_state = {}
_listeners = []


def _bucket(server_id):
    return _state.setdefault(
        str(server_id),
        {"seeds": set(), "lobbies": {}, "rcon": None},
    )


def on_live_change(fn):
    _listeners.append(fn)


async def _notify():
    for fn in list(_listeners):
        try:
            result = fn()
            if hasattr(result, "__await__"):
                await result
        except Exception as error:
            print("Обновление панели:", error)


def add_seed(server_id, steam_id):
    if steam_id:
        _bucket(server_id)["seeds"].add(str(steam_id))


def remember_lobby(server_id, entry):
    steam_id = str(entry.get("steamId") or "")
    if steam_id and not steam_id.startswith("manual-"):
        add_seed(server_id, steam_id)
    _bucket(server_id)["lobbies"][steam_id or entry.get("lobbyId")] = {
        **entry,
        "updatedAt": time.time(),
    }


def get_live_info(server, extra=None):
    extra = extra or _bucket(server["id"]).get("rcon")
    if server["coming_soon"]:
        return {"status": "soon", "players": 0, "maxPlayers": 0, "map": ""}
    if not extra:
        ready = STEAM_KEY or server["addr"] or server["rcon_host"]
        return {
            "status": "offline" if ready else "noconfig",
            "players": 0,
            "maxPlayers": 0,
            "map": "",
        }
    return {
        "status": "online",
        "players": int(extra.get("players") or 0),
        "maxPlayers": int(extra.get("maxPlayers") or 0),
        "map": extra.get("map") or "",
    }


async def _rcon_get(session, server, path):
    url = f"http://{server['rcon_host']}:{server['rcon_port'] or 80}{path}"
    headers = {"Authorization": f"Bearer {server['rcon_password']}"}
    timeout = aiohttp.ClientTimeout(total=8)
    async with session.get(url, headers=headers, timeout=timeout) as response:
        response.raise_for_status()
        return await response.json()


async def fetch_players(session, server):
    if not server["rcon_host"] or not server["rcon_password"]:
        return []
    data = await _rcon_get(session, server, "/v1/players")
    return data.get("players") or []


async def query_rcon(session, server):
    if not server["rcon_host"] or not server["rcon_password"]:
        return None
    status = await _rcon_get(session, server, "/v1/status")
    try:
        players = await fetch_players(session, server)
        ok = True
    except Exception:
        players = []
        ok = False
    steam_ids = [
        str(player.get("steamId") or "")
        for player in players
        if re.fullmatch(r"7656119\d{10}", str(player.get("steamId") or ""))
    ]
    return {
        "name": status.get("serverName") or server["query"],
        "map": status.get("map") or "",
        "players": len(players) if ok else int((status.get("players") or {}).get("current") or 0),
        "maxPlayers": int((status.get("players") or {}).get("max") or 0),
        "steamIds": steam_ids,
    }


async def _steam_summaries(session, steam_ids):
    if not STEAM_KEY or not steam_ids:
        return []
    players = []
    unique = list(dict.fromkeys(steam_ids))
    for i in range(0, len(unique), 100):
        params = {"key": STEAM_KEY, "steamids": ",".join(unique[i : i + 100])}
        url = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as response:
            response.raise_for_status()
            data = await response.json()
            players.extend(((data.get("response") or {}).get("players")) or [])
    return players


def _lobby_from_summary(player):
    if str(player.get("gameid") or "") != str(APP_ID):
        return None
    lobby_id = str(player.get("lobbysteamid") or "")
    if not lobby_id:
        return None
    return {
        "steamId": str(player.get("steamid") or ""),
        "lobbyId": lobby_id,
        "appId": str(player.get("gameid") or APP_ID),
        "persona": player.get("personaname") or "",
    }


def steam_join_url(app_id, lobby_id, steam_id):
    return f"steam://joinlobby/{app_id}/{lobby_id}/{steam_id}"


def parse_steam_join(link):
    match = re.match(r"^steam://joinlobby/(\d+)/(\d+)(?:/(\d+))?", str(link or "").strip(), re.I)
    if not match:
        return None
    return {"appId": match.group(1), "lobbyId": match.group(2), "steamId": match.group(3) or ""}


def _pick_lobby(server_id):
    now = time.time()
    live = []
    for entry in _bucket(server_id)["lobbies"].values():
        if now - float(entry.get("updatedAt") or 0) > STALE_SEC:
            continue
        if str(entry.get("appId") or APP_ID) != str(APP_ID):
            continue
        if entry.get("lobbyId"):
            live.append(entry)
    return live[0] if live else None


async def live_join(session, server):
    if not server:
        return {"ok": False, "reason": "missing"}
    if server["coming_soon"]:
        return {"ok": False, "reason": "soon", "server": server}

    live = get_live_info(server)
    steam_ids = []
    if server["rcon_host"] and server["rcon_password"]:
        try:
            players = await fetch_players(session, server)
            steam_ids = [
                str(player.get("steamId") or "")
                for player in players
                if re.fullmatch(r"7656119\d{10}", str(player.get("steamId") or ""))
            ]
            for steam_id in steam_ids:
                add_seed(server["id"], steam_id)
        except Exception as error:
            print(f"Игроки {server['name']}:", error)

    if STEAM_KEY and steam_ids:
        for player in await _steam_summaries(session, steam_ids):
            lobby = _lobby_from_summary(player)
            if lobby:
                remember_lobby(server["id"], lobby)
                return {
                    "ok": True,
                    "server": server,
                    "live": live,
                    "steamUrl": steam_join_url(lobby["appId"], lobby["lobbyId"], lobby["steamId"]),
                }

    cached = _pick_lobby(server["id"])
    if cached:
        return {
            "ok": True,
            "server": server,
            "live": live,
            "steamUrl": steam_join_url(cached["appId"], cached["lobbyId"], cached.get("steamId") or ""),
        }

    return {
        "ok": False,
        "reason": "empty" if not steam_ids else "nolobby",
        "server": server,
        "live": live,
    }


async def refresh(session, servers):
    for server in servers:
        if not server["rcon_host"] or not server["rcon_password"]:
            _bucket(server["id"])["rcon"] = None
            continue
        try:
            info = await query_rcon(session, server)
            fingerprint = (
                f"{info['players']}/{info['maxPlayers']} {info['map']}" if info else "null"
            )
            prev = _bucket(server["id"]).get("fingerprint")
            _bucket(server["id"])["rcon"] = info
            _bucket(server["id"])["fingerprint"] = fingerprint
            for steam_id in (info or {}).get("steamIds") or []:
                add_seed(server["id"], steam_id)
            if info and fingerprint != prev:
                print(f"RCON {server['name']}: {fingerprint}")
        except Exception as error:
            _bucket(server["id"])["rcon"] = None
            print(f"RCON {server['name']}:", error)
    await _notify()


async def poll_loop(session, servers):
    while True:
        try:
            await refresh(session, servers)
        except Exception as error:
            print("Опрос не удался:", error)
        await asyncio.sleep(POLL_SEC)


def status(servers):
    return {
        "community": community_name(),
        "appId": APP_ID,
        "servers": [
            {
                "id": server["id"],
                "name": server["name"],
                "query": server["query"],
                **get_live_info(server),
            }
            for server in servers
        ],
    }
