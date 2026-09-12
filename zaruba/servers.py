import os
import re


def _ids(value):
    return [item.strip() for item in re.split(r"[,\s]+", str(value or "")) if item.strip()]


def make_server(server_id):
    key = str(server_id)
    name = os.getenv(f"SERVER_{key}_NAME") or f"СЕРВЕР {key}"
    return {
        "id": key,
        "name": name,
        "query": os.getenv(f"SERVER_{key}_QUERY") or name,
        "game_id": os.getenv(f"SERVER_{key}_GAME_ID") or "",
        "coming_soon": os.getenv(f"SERVER_{key}_SOON") == "1",
        "bot_token": os.getenv(f"SERVER_{key}_BOT_TOKEN") or "",
        "addr": os.getenv(f"SERVER_{key}_ADDR") or "",
        "rcon_host": os.getenv(f"SERVER_{key}_RCON_HOST") or "",
        "rcon_port": os.getenv(f"SERVER_{key}_RCON_PORT") or "",
        "rcon_password": os.getenv(f"SERVER_{key}_RCON_PASSWORD") or "",
        "seeds": _ids(os.getenv(f"SERVER_{key}_SEEDS")),
    }


SERVERS = [make_server(i) for i in (1, 2, 3, 4)]


def visible_servers():
    return [
        server
        for server in SERVERS
        if server["rcon_host"] or server["addr"] or server["coming_soon"]
    ]


def get_server(server_id):
    key = re.sub(r"^(server|сервер)[-_\s]*", "", str(server_id or "").strip().lower())
    return next((server for server in SERVERS if server["id"] == key), None)
