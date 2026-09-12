import { spawn } from "child_process";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import path from "path";
import { fileURLToPath } from "url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin");
const EXE = path.join(BIN, "cloudflared.exe");
const DOWNLOAD =
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

function alreadySet() {
  return String(process.env.PUBLIC_URL || "").replace(/\/$/, "");
}

async function ensureCloudflared() {
  if (existsSync(EXE)) return EXE;
  mkdirSync(BIN, { recursive: true });
  console.log("Скачиваю Cloudflare tunnel...");
  const res = await fetch(DOWNLOAD, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`не скачался cloudflared: ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(EXE));
  return EXE;
}

function waitForUrl(child, timeoutMs) {
  return new Promise((resolve) => {
    let found = "";
    const timer = setTimeout(() => resolve(found), timeoutMs);
    const onData = (buf) => {
      const text = String(buf);
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!match || found) return;
      found = match[0];
      clearTimeout(timer);
      resolve(found);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("exit", () => {
      if (!found) {
        clearTimeout(timer);
        resolve("");
      }
    });
  });
}

export async function startPublicUrl(port) {
  const existing = alreadySet();
  if (existing) return existing;

  try {
    const exe = await ensureCloudflared();
    const child = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.unref?.();
    const url = await waitForUrl(child, 20000);
    if (!url) {
      console.log("Туннель не поднялся — кнопки останутся прямыми в Discord");
      return "";
    }
    process.env.PUBLIC_URL = url;
    return url;
  } catch (error) {
    console.log(`Туннель не поднялся: ${error.message}`);
    return "";
  }
}
