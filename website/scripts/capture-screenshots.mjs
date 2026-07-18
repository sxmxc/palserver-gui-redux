#!/usr/bin/env node
/**
 * 對「正在運行的 palserver GUI」截圖,產生官網各語言介面截圖。
 * 需要一個可連的 agent(最好是有跑起來的 demo 實例、且支援模組的 Windows 機器,
 * 這樣 engine/mods 才有內容)。用 playwright 驅動,自動切語言、開分頁、截 1320 寬。
 *
 *   AGENT_URL=http://127.0.0.1:8250 AGENT_TOKEN=xxx \
 *     node scripts/capture-screenshots.mjs [screens...] [--langs=en,ja]
 *
 * screens 可選:login announcement engine mods(預設全部)。loopback(127.0.0.1)
 * 免 token;tailnet/遠端要帶 AGENT_TOKEN(= 你瀏覽器配對過的長 token)。
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = process.env.OUT_DIR || path.resolve(HERE, "../public/assets");
const AGENT = process.env.AGENT_URL || "http://127.0.0.1:8250";
const TOKEN = process.env.AGENT_TOKEN || "";
// APP_URL = App 本身的位址(可跟 agent 不同,例如 vite dev localhost:5173 連本機 agent)。
const APP = process.env.APP_URL || AGENT;
const W = 1320;

const argv = process.argv.slice(2);
const langArg = argv.find((a) => a.startsWith("--langs="));
const LANGS = langArg ? langArg.slice(8).split(",") : ["en", "ja"];
const screens = argv.filter((a) => !a.startsWith("--"));
const WANT = screens.length ? screens : ["login", "announcement", "engine", "mods"];

const CONN = JSON.stringify({ url: AGENT, token: TOKEN });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 與既有截圖同框:1320 寬,分頁頁面 848 高、連線/公告 984 高(視窗裁切,非整頁)。
const HEIGHTS = { login: 984, announcement: 984, engine: 848, mods: 848 };

async function shot(page, lang, name) {
  await page.setViewportSize({ width: W, height: HEIGHTS[name] || 848 });
  await sleep(400);
  const out = path.join(ASSETS, lang, name + ".jpg");
  await page.screenshot({ path: out, type: "jpeg", quality: 92, fullPage: false });
  console.log("wrote", lang + "/" + name + ".jpg");
}

/** 新 context:注入語言;connected 時注入連線;markSeen 時把公告標為已看(略過彈窗)。 */
async function ctxFor(browser, lang, connected, markSeen) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(
    ([lang, conn, connected, markSeen, seen]) => {
      localStorage.setItem("palserver.lang", lang);
      if (connected) {
        localStorage.setItem("palserver.connection", conn);
        if (markSeen) localStorage.setItem("palserver.announcementsSeen", seen);
        else localStorage.removeItem("palserver.announcementsSeen");
      } else {
        localStorage.removeItem("palserver.connection");
      }
    },
    [lang, CONN, connected, markSeen, JSON.stringify(["2026-07-welcome-2-0", "2026-07-10-palguard-1-0"])],
  );
  return ctx;
}

/** 逐則點掉公告彈窗,避免擋住導覽。 */
async function dismissAnnounce(page) {
  for (let i = 0; i < 8; i++) {
    const btn = page.locator("button", { hasText: /開始|下一則|Next|Start|始め|次|閉じる|Close|關閉|了解/ }).first();
    if (await btn.count().then((c) => c > 0).catch(() => false)) {
      await btn.click().catch(() => {});
      await sleep(300);
    } else break;
  }
}

async function openInstanceTab(page, tab) {
  await page.waitForSelector(".grid button, [data-testid='create-server']", { timeout: 15000 });
  const cards = page.locator(".grid button").filter({ has: page.locator("strong") });
  await cards.first().click();
  await page.waitForSelector("[data-tab='" + tab + "']", { timeout: 15000 });
  await page.locator("[data-tab='" + tab + "']").click();
  await sleep(1200);
}

async function main() {
  const browser = await chromium.launch();
  for (const lang of LANGS) {
    if (WANT.includes("login")) {
      const ctx = await ctxFor(browser, lang, false, false);
      const page = await ctx.newPage();
      // ?setup 強制顯示「第一次連線」畫面(需純網頁版 App,agent 同源會自動連線跳過)。
      await page.goto(APP + "/?setup", { waitUntil: "domcontentloaded" });
      await sleep(1800);
      await shot(page, lang, "login");
      await ctx.close();
    }
    if (WANT.includes("announcement")) {
      // 連線但不標已看 → 公告彈窗會自動跳(內文依語言 filter)。
      const ctx = await ctxFor(browser, lang, true, false);
      const page = await ctx.newPage();
      // 擋掉 GitHub 遠端公告(可能還是舊版沒傳播),強制用本機最新的 /announcement.md。
      await page.route("**/raw.githubusercontent.com/**", (r) => r.abort());
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await sleep(3000); // 等公告載入 + 彈窗出現
      await shot(page, lang, "announcement");
      await ctx.close();
    }
    if (WANT.includes("engine") || WANT.includes("mods")) {
      const ctx = await ctxFor(browser, lang, true, true);
      const page = await ctx.newPage();
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await sleep(1800);
      await dismissAnnounce(page);
      if (WANT.includes("engine")) {
        await openInstanceTab(page, "engine");
        await shot(page, lang, "engine");
      }
      if (WANT.includes("mods")) {
        await page.goto(APP, { waitUntil: "domcontentloaded" });
        await sleep(1200);
        await dismissAnnounce(page);
        await openInstanceTab(page, "mods");
        await shot(page, lang, "mods");
      }
      await ctx.close();
    }
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
