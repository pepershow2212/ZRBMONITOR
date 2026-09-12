import "dotenv/config";
import { communityName, monitorsEnabled, panelEnabled } from "./flags.js";

if (!process.env.SERVER_1_BOT_TOKEN) {
  process.env.SERVER_1_BOT_TOKEN =
    process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || "";
}

const { startPolling } = await import("./tracker.js");
const { startMonitors } = await import("./monitor.js");
const { startBot } = await import("./bot.js");
const { startJoinServer } = await import("./web.js");

console.log(
  `${communityName()} host: панель=${panelEnabled() ? "вкл" : "выкл"} мониторы=${monitorsEnabled() ? "вкл" : "выкл"}`
);
await startJoinServer();
startPolling();

if (panelEnabled()) {
  startBot()
    .then((client) => {
      if (!client) {
        console.log("Панель не стартанула: нет DISCORD_TOKEN");
      }
    })
    .catch((error) => {
      console.error("Панель не стартанула:", error.message);
    });
} else {
  console.log("Панель выключена: ENABLE_PANEL=0");
}

if (monitorsEnabled()) {
  startMonitors().catch((error) => {
    console.error("Мониторы не стартанули:", error.message);
  });
} else {
  console.log("Мониторы выключены: ENABLE_MONITORS=0");
}
