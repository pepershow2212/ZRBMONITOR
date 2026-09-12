import os
from urllib.parse import urlparse


def raw(name, default=""):
    return str(os.getenv(name, default) or "").strip()


def env_on(name, default=True):
    value = raw(name).lower()
    if not value:
        return default
    return value not in ("0", "false", "off", "no", "n")


def panel_enabled():
    if raw("ENABLE_PANEL"):
        return env_on("ENABLE_PANEL")
    return raw("SKIP_PANEL") != "1"


def monitors_enabled():
    if raw("ENABLE_MONITORS"):
        return env_on("ENABLE_MONITORS")
    return raw("SKIP_MONITORS") != "1"


def community_name():
    return raw("COMMUNITY_NAME") or raw("WARDOGS_SERVER_NAME") or "ZARUBA"


def game_app_id():
    return raw("GAME_APP_ID") or raw("WARDOGS_APP_ID") or "1867240"


def banner_url():
    return raw("PANEL_BANNER_URL") or "https://i.ibb.co/1Ypjc3nv/12121212.jpg"


def public_url():
    direct = raw("PUBLIC_URL") or raw("DOMAIN")
    if direct:
        if direct.startswith("http://") or direct.startswith("https://"):
            return direct.rstrip("/")
        return f"https://{direct}".rstrip("/")

    hook = raw("WEBHOOK_URL")
    if hook.startswith("http"):
        try:
            return urlparse(hook)._replace(path="", params="", query="", fragment="").geturl().rstrip("/")
        except Exception:
            pass

    bot_id = raw("BOT_ID")
    if not bot_id:
        return ""
    slug = bot_id
    if slug.lower().startswith("bot-") or slug.lower().startswith("bot_"):
        slug = slug[4:]
    slug = slug.replace("_", "-")
    return f"https://bot-{slug}.bothost.tech" if slug else ""
