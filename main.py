import asyncio
import os

from dotenv import load_dotenv

load_dotenv()

if not os.getenv("SERVER_1_BOT_TOKEN"):
    os.environ["SERVER_1_BOT_TOKEN"] = (
        os.getenv("DISCORD_BOT_TOKEN") or os.getenv("BOT_TOKEN") or ""
    )

import aiohttp

from zaruba.config import community_name, monitors_enabled, panel_enabled
from zaruba.discord_host import start_monitors, start_panel
from zaruba.servers import SERVERS
from zaruba.tracker import poll_loop
from zaruba.web import start_web


async def main():
    print(
        f"{community_name()} host: панель={'вкл' if panel_enabled() else 'выкл'} "
        f"мониторы={'вкл' if monitors_enabled() else 'выкл'}"
    )
    async with aiohttp.ClientSession() as session:
        await start_web(session, SERVERS)
        asyncio.create_task(poll_loop(session, SERVERS), name="poll")
        if panel_enabled():
            asyncio.create_task(start_panel(session), name="panel")
        else:
            print("Панель выключена: ENABLE_PANEL=0")
        if monitors_enabled():
            await start_monitors(SERVERS)
        else:
            print("Мониторы выключены: ENABLE_MONITORS=0")
        await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
