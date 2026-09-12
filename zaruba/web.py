import html
import json

from aiohttp import web

from zaruba.config import banner_url, community_name, public_url
from zaruba.servers import get_server
from zaruba.tracker import (
    add_seed,
    live_join,
    parse_steam_join,
    remember_lobby,
    status,
    steam_join_url,
    APP_ID,
)


def _join_html(result):
    server = (result or {}).get("server") or {}
    live = (result or {}).get("live") or {}
    ok = bool((result or {}).get("ok") and (result or {}).get("steamUrl"))
    name = server.get("name") or community_name()
    query = server.get("query") or ""
    steam = (result or {}).get("steamUrl") or ""
    players = live.get("players") or 0
    max_players = live.get("maxPlayers") or 0
    count = f"{players}/{max_players}" if max_players else str(players)
    live_text = f"{count} · {live['map']}" if live.get("map") else count
    if ok:
        status_text = "Открываем Steam…"
        hint = "Игра должна быть уже запущена. Если Steam не открылся — жми ещё раз."
    elif (result or {}).get("reason") == "empty":
        status_text = "Сервер пустой. Первый заходит из списка серверов в игре."
        hint = f"В игре ищите: {query}" if query else "Запусти игру и подожди пару секунд."
    else:
        status_text = "Ищем лобби, страница сама кинет в игру."
        hint = f"В игре ищите: {query}" if query else "Запусти игру и подожди пару секунд."

    refresh = f'<meta http-equiv="refresh" content="0;url={html.escape(steam)}">' if ok else ""
    button = "" if ok else "hidden"
    payload = json.dumps(server.get("id") or "")
    steam_js = json.dumps(steam)

    return f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  {refresh}
  <title>{html.escape(name)}</title>
  <style>
    body {{ margin:0; min-height:100vh; display:grid; place-items:center; font-family:Segoe UI,Arial,sans-serif; background:#0b0d11; color:#f2f4f8; }}
    .card {{ width:min(520px, calc(100vw - 24px)); overflow:hidden; background:#14181f; border:1px solid #2a303c; border-radius:18px; }}
    img {{ display:block; width:100%; }}
    .box {{ padding:22px; text-align:center; }}
    a.play {{ display:inline-block; min-width:180px; padding:12px 20px; border-radius:10px; background:#16a34a; color:#fff; text-decoration:none; font-weight:700; }}
    a.play[hidden] {{ display:none; }}
    .wait {{ color:#f59e0b; }}
    .live,.hint {{ color:#8b93a3; }}
  </style>
</head>
<body>
  <main class="card">
    <img src="{html.escape(banner_url())}" alt="{html.escape(community_name())}">
    <div class="box">
      <h1>{html.escape(name)}</h1>
      <p class="live" id="live">{html.escape(live_text)}</p>
      <p class="{'wait' if not ok else ''}" id="status">{html.escape(status_text)}</p>
      <p class="hint" id="hint">{html.escape(hint)}</p>
      <a class="play" id="play" href="{html.escape(steam)}" {button}>Играть</a>
    </div>
  </main>
  <script>
    const serverId = {payload};
    const play = document.getElementById("play");
    let launched = false;
    function launch(url) {{
      if (!url || launched) return;
      launched = true;
      play.href = url; play.hidden = false;
      location.href = url;
    }}
    async function poll() {{
      if (launched || !serverId) return;
      try {{
        const res = await fetch("/api/join-link?server=" + encodeURIComponent(serverId), {{ cache: "no-store" }});
        const data = await res.json();
        if (data.steamUrl) {{ launch(data.steamUrl); return; }}
      }} catch (e) {{}}
      setTimeout(poll, 1000);
    }}
    {"launch(" + steam_js + ");" if ok else "poll();"}
  </script>
</body>
</html>"""


def create_app(session, servers):
    app = web.Application()

    async def health(_request):
        return web.json_response({"ok": True})

    async def root(_request):
        raise web.HTTPFound("/join?server=1")

    async def api_status(_request):
        return web.json_response(status(servers))

    async def api_join(request):
        server = get_server(request.query.get("server") or request.query.get("name"))
        if not server:
            return web.json_response({"ok": False, "reason": "missing"}, status=404)
        result = await live_join(session, server)
        return web.json_response({
            "ok": bool(result.get("ok") and result.get("steamUrl")),
            "reason": result.get("reason") or ("ready" if result.get("ok") else "nolobby"),
            "steamUrl": result.get("steamUrl") or "",
            "server": {"id": server["id"], "name": server["name"], "query": server["query"]},
            "live": result.get("live") or {},
        })

    async def join_page(request):
        server = get_server(request.query.get("server") or request.query.get("name"))
        if not server:
            return web.Response(
                text=_join_html({"ok": False, "reason": "missing", "server": {"name": community_name()}}),
                content_type="text/html",
            )
        result = await live_join(session, server)
        return web.Response(text=_join_html(result), content_type="text/html")

    async def report(request):
        body = await request.json()
        server = get_server(body.get("server"))
        parsed = parse_steam_join(body.get("link"))
        if not server or not parsed or not parsed.get("lobbyId"):
            return web.json_response({"error": "Нужны server и steam://joinlobby/..."}, status=400)
        if parsed["appId"] != APP_ID:
            return web.json_response({"error": f"Ожидается appId {APP_ID}"}, status=400)
        if parsed.get("steamId"):
            add_seed(server["id"], parsed["steamId"])
        remember_lobby(server["id"], parsed)
        return web.json_response({
            "ok": True,
            "link": steam_join_url(parsed["appId"], parsed["lobbyId"], parsed.get("steamId") or ""),
        })

    app.router.add_get("/", root)
    app.router.add_get("/health", health)
    app.router.add_get("/api/status", api_status)
    app.router.add_get("/api/join-link", api_join)
    app.router.add_get("/api/wardogs/join-link", api_join)
    app.router.add_get("/join", join_page)
    app.router.add_post("/api/report-link", report)
    return app


async def start_web(session, servers):
    import os

    port = int(os.getenv("PORT") or 3000)
    runner = web.AppRunner(create_app(session, servers))
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    url = public_url()
    if url:
        os.environ["PUBLIC_URL"] = url
    print(f"Join слушает 0.0.0.0:{port} PUBLIC={url or '-'}")
    return runner
