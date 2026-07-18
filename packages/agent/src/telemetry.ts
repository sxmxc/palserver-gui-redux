import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AGENT_VERSION, DATA_DIR, STATS_URL, TELEMETRY_DISABLED_BY_ENV } from "./env.js";

/**
 * 匿名使用統計(遙測)。隱私原則見 PRIVACY.md:
 *  - 只送隨機產生的匿名安裝 ID、事件類型、agent 版本、OS 平台
 *  - 玩家只送單向雜湊(用於全球不重複玩家計數),不送原始識別碼或名稱
 *  - 預設開啟;GUI 內可關閉,或設 PALSERVER_TELEMETRY=0 強制停用
 *
 * 所有上報都是 fire-and-forget:失敗靜默丟棄,絕不影響 agent 本體運作。
 */

const STATE_FILE = path.join(DATA_DIR, "telemetry.json");
/** 本地「已上報玩家」名單的上限 — 只是省流量的快取,超出讓伺服器端去重。 */
const MAX_REPORTED_PLAYERS = 5000;

interface TelemetryState {
  installId: string;
  enabled: boolean;
  reportedPlayers: string[];
}

let state: TelemetryState | null = null;

function load(): TelemetryState {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<TelemetryState>;
    state = {
      installId: typeof raw.installId === "string" && raw.installId ? raw.installId : crypto.randomUUID(),
      enabled: raw.enabled !== false,
      reportedPlayers: Array.isArray(raw.reportedPlayers) ? raw.reportedPlayers : [],
    };
  } catch {
    state = { installId: crypto.randomUUID(), enabled: true, reportedPlayers: [] };
  }
  save();
  return state;
}

function save(): void {
  if (!state) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* 寫不進去就算了,下次重啟會換一個匿名 ID,對統計影響極小 */
  }
}

const isEnabled = (): boolean => !TELEMETRY_DISABLED_BY_ENV && load().enabled;

export interface TelemetryStatus {
  enabled: boolean;
  /** true = 被 PALSERVER_TELEMETRY=0 強制停用,GUI 開關無效。 */
  envDisabled: boolean;
  installId: string;
}

export function telemetryStatus(): TelemetryStatus {
  const s = load();
  return { enabled: !TELEMETRY_DISABLED_BY_ENV && s.enabled, envDisabled: TELEMETRY_DISABLED_BY_ENV, installId: s.installId };
}

export function setTelemetryEnabled(enabled: boolean): TelemetryStatus {
  load().enabled = enabled;
  save();
  return telemetryStatus();
}

async function send(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${STATS_URL}/api/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installId: load().installId,
        version: AGENT_VERSION,
        platform: process.platform,
        ...payload,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 累計事件:建立伺服器 / 啟動伺服器。 */
export function track(type: "instance_created" | "server_started"): void {
  if (!isEnabled()) return;
  void send({ type });
}

/** agent 啟動時打一聲招呼 — 登記/更新匿名安裝,用於管理者總數(去重)。 */
export function announceBoot(): void {
  if (!isEnabled()) return;
  void send({ type: "hello" });
}

/** 玩家識別碼 → 截短的單向雜湊。上傳與儲存的只有這個值。 */
const hashPlayer = (userId: string): string =>
  crypto.createHash("sha256").update(`palserver-player:${userId}`).digest("hex").slice(0, 32);

/** 回報看到的玩家(取雜湊、本地去重、分批上傳),用於全球不重複玩家計數。 */
export function trackPlayers(userIds: string[]): void {
  if (!isEnabled() || userIds.length === 0) return;
  const s = load();
  const seen = new Set(s.reportedPlayers);
  const fresh = [...new Set(userIds.map(hashPlayer))].filter((h) => !seen.has(h));
  if (fresh.length === 0) return;
  void (async () => {
    for (let i = 0; i < fresh.length; i += 100) {
      const batch = fresh.slice(i, i + 100);
      if (!(await send({ type: "players_seen", players: batch }))) break;
      s.reportedPlayers = [...s.reportedPlayers, ...batch].slice(-MAX_REPORTED_PLAYERS);
      save();
    }
  })();
}
