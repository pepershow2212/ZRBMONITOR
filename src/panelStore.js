import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "panel.json");

export function loadPanelRef() {
  try {
    const data = JSON.parse(readFileSync(FILE, "utf8"));
    if (!data?.channelId || !data?.messageId) return null;
    return data;
  } catch {
    return null;
  }
}

export function savePanelRef(ref) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(ref, null, 2));
}

export function clearPanelRef() {
  try {
    writeFileSync(FILE, "{}");
  } catch {
    // ignore
  }
}
