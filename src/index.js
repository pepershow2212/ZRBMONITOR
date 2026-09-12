import "dotenv/config";
import { monitorsEnabled, panelEnabled } from "./flags.js";
import { startBot } from "./bot.js";
import { startMonitors } from "./monitor.js";
import { startPublicUrl } from "./tunnel.js";
import { startPolling } from "./tracker.js";
import { resolvePublicUrl, startJoinServer } from "./web.js";

async function main() {
  const server = await startJoinServer();
  const port = Number(process.env.PORT || 3000);
  startPolling();
  if (!resolvePublicUrl()) {
    const url = await startPublicUrl(port);
    if (url) {
      process.env.PUBLIC_URL = url;
      console.log(`Публичный join: ${url}/join?server=1`);
    }
  }
  if (!panelEnabled()) {
    console.log("Панель выключена: ENABLE_PANEL=0");
  } else {
    startBot().catch((error) => {
      console.error("Discord бот не стартанул:", error.message);
    });
  }
  if (!monitorsEnabled()) {
    console.log("Мониторы выключены: ENABLE_MONITORS=0");
  } else {
    startMonitors().catch((error) => {
      console.error("Мониторы не стартанули:", error.message);
    });
  }
  return server;
}

if (process.env.BOT_ID && process.env.BOTHOST !== "0") {
  await import("./monitor-app.js");
} else {
  main().catch((error) => {
    console.error("Не стартануло:", error.message);
    process.exit(1);
  });
}
