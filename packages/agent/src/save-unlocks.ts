import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DriverContext } from "./driver.js";
import type { InstanceRecord } from "./store.js";
import { activeWorldGuidAsync, createBackup, worldDirOf } from "./saves.js";
import { ensurePalsav, palsavAssetName } from "./save-tools.js";
import { FAST_TRAVEL_GUIDS } from "./fast-travel-points.js";

const execFileP = promisify(execFile);

/**
 * 存檔解鎖(贊助者 map-unlocks):改寫「玩家個人存檔」的 RecordData。
 * 目前提供「快速傳送全開」— 把全部快速傳送點 GUID 寫進每個玩家的
 * FastTravelPointUnlockFlag(MapProperty NameProperty→BoolProperty)。
 *
 * 結構與 GUID 皆以真實存檔驗證(2026-07-17;路徑
 * properties.SaveData.value.RecordData.value.FastTravelPointUnlockFlag,
 * GUID 為遊戲靜態資產、跨世界一致 — 不存在於 Level.sav)。
 *
 * 安全姿態:僅伺服器停止時可執行(路由把關);動手前整世界備份;
 * 逐檔「暫存寫入→原子 rename」,單檔失敗不影響其他玩家檔。
 * 轉換走 palsav(json↔sav 已實測位元組等值往返)。
 */


/** 把 GUID 清單合併進玩家存檔 JSON(缺的層級按實測 GVAS 形狀合成)。 */
export function patchFastTravelJson(
  doc: Record<string, any>,
  guids: string[] = FAST_TRAVEL_GUIDS,
): { before: number; after: number } {
  const sd = doc?.properties?.SaveData;
  if (!sd || typeof sd !== "object") throw new Error("Not a player save (properties.SaveData is missing)");
  sd.value ??= {};
  let rd = sd.value.RecordData;
  if (!rd || typeof rd !== "object") {
    rd = sd.value.RecordData = {
      struct_type: "PalLoggedinPlayerSaveDataRecordData",
      struct_id: "00000000-0000-0000-0000-000000000000",
      id: null,
      value: {},
      type: "StructProperty",
    };
  }
  rd.value ??= {};
  let flag = rd.value.FastTravelPointUnlockFlag;
  if (!flag || typeof flag !== "object") {
    flag = rd.value.FastTravelPointUnlockFlag = {
      key_type: "NameProperty",
      value_type: "BoolProperty",
      key_struct_type: null,
      value_struct_type: null,
      id: null,
      value: [],
      type: "MapProperty",
    };
  }
  flag.value ??= [];
  const entries = flag.value as { key: string; value: boolean }[];
  const seen = new Set(entries.map((e) => String(e.key).toUpperCase()));
  const before = entries.filter((e) => e.value === true).length;
  for (const e of entries) e.value = true; // 原本 false 的一併翻開
  for (const g of guids) {
    if (!seen.has(g.toUpperCase())) {
      entries.push({ key: g, value: true });
      seen.add(g.toUpperCase());
    }
  }
  return { before, after: entries.length };
}

export interface UnlockResult {
  file: string;
  ok: boolean;
  /** 解鎖前已開的點數 → 解鎖後總點數;失敗時為錯誤訊息。 */
  detail: string;
}

export function saveUnlocksSupport(rec: InstanceRecord): { supported: boolean; reason?: string } {
  if (rec.backend !== "native") return { supported: false, reason: "Save unlocks are only supported in native mode" };
  if (!palsavAssetName(rec) && !process.env.PALSERVER_PALSAV_BIN) {
    return { supported: false, reason: "This host platform does not support save tools (x64 Windows/Linux required)" };
  }
  return { supported: true };
}

/** 對世界內全部玩家檔解鎖快速傳送。呼叫端需確保伺服器已停止。 */
export async function unlockAllFastTravel(
  rec: InstanceRecord,
  ctx: DriverContext,
): Promise<{ worldGuid: string; players: UnlockResult[]; total: number }> {
  const support = saveUnlocksSupport(rec);
  if (!support.supported) throw Object.assign(new Error(support.reason), { statusCode: 409 });
  if (FAST_TRAVEL_GUIDS.length === 0) {
    throw Object.assign(new Error("Fast-travel point list is not bundled; update the agent"), { statusCode: 500 });
  }
  const guid = await activeWorldGuidAsync(rec, ctx);
  if (!guid) throw Object.assign(new Error("Active world save not found (is DedicatedServerName missing from GameUserSettings.ini?)"), { statusCode: 409 });

  const playersDir = path.join(worldDirOf(rec, ctx, guid), "Players");
  if (!fs.existsSync(playersDir)) {
    throw Object.assign(new Error("Player save directory not found (has any player joined yet?)"), { statusCode: 409 });
  }
  const files = fs.readdirSync(playersDir).filter((f) => f.toLowerCase().endsWith(".sav"));
  if (files.length === 0) {
    throw Object.assign(new Error("No player saves found"), { statusCode: 409 });
  }

  // 動手前整世界備份(含 Players/);失敗就中止,不做沒有退路的寫入。
  await createBackup(rec, ctx, guid);

  const bin = process.env.PALSERVER_PALSAV_BIN ?? (await ensurePalsav(rec));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "palunlock-"));
  const players: UnlockResult[] = [];
  try {
    for (const file of files) {
      const src = path.join(playersDir, file);
      const jsonPath = path.join(tmp, `${file}.json`);
      const outSav = path.join(tmp, `${file}.new`);
      try {
        // 參數形式沿用 save-tools 既有呼叫(無子指令);from-json 走 convert 子指令(皆實測)
        await execFileP(bin, ["--to-json", "-o", jsonPath, "--minify-json", "-f", src], {
          windowsHide: true,
          timeout: 5 * 60_000,
        });
        const doc = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        const { before, after } = patchFastTravelJson(doc);
        fs.writeFileSync(jsonPath, JSON.stringify(doc));
        await execFileP(bin, ["convert", "--from-json", "-o", outSav, jsonPath], {
          windowsHide: true,
          timeout: 5 * 60_000,
        });
        if (!fs.existsSync(outSav) || fs.statSync(outSav).size === 0) throw new Error("Failed to convert back to .sav (output is empty)");
        // 原子替換:先寫進同資料夾暫名再 rename,避免寫到一半的檔案
        const staged = path.join(playersDir, `${file}.palserver-new`);
        fs.copyFileSync(outSav, staged);
        fs.renameSync(staged, src);
        players.push({ file, ok: true, detail: `${before} → ${after}` });
      } catch (err) {
        players.push({ file, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { worldGuid: guid, players, total: FAST_TRAVEL_GUIDS.length };
}
