function raw(name) {
  return String(process.env[name] ?? "").trim();
}

export function envOn(name, defaultOn = true) {
  const value = raw(name).toLowerCase();
  if (!value) return defaultOn;
  return !["0", "false", "off", "no", "n"].includes(value);
}

export function panelEnabled() {
  if (raw("ENABLE_PANEL")) return envOn("ENABLE_PANEL", true);
  if (raw("SKIP_PANEL") === "1") return false;
  return true;
}

export function monitorsEnabled() {
  if (raw("ENABLE_MONITORS")) return envOn("ENABLE_MONITORS", true);
  if (raw("SKIP_MONITORS") === "1") return false;
  return true;
}

export function communityName() {
  return raw("COMMUNITY_NAME") || raw("WARDOGS_SERVER_NAME") || "ZARUBA";
}

export function gameAppId() {
  return raw("GAME_APP_ID") || raw("WARDOGS_APP_ID") || "1867240";
}

export function bannerUrl() {
  return raw("PANEL_BANNER_URL") || "https://i.ibb.co/1Ypjc3nv/12121212.jpg";
}
