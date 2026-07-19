import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { HostFixResult } from "@palserver/shared";
import { oodleDecompress } from "./oodle.js";

/**
 * 內建版 palworld-host-save-fix(github.com/xNul/palworld-host-save-fix)。
 *
 * 用途:本機共玩存檔搬上專用伺服器後,主機玩家的角色綁在固定的
 * PlayerUid 00000000-…-0001 上,而專用伺服器給他的是新 Uid → 進來被要求重建角色。
 * 修法 = 把舊角色資料過戶給新 Uid:改玩家 .sav 的兩個 PlayerUId 欄位、
 * 改 Level.sav 裡該角色條目的 PlayerUId,再把玩家檔改名成 <新Uid>.sav。
 *
 * 實作方式與參考工具不同:不做完整 GVAS 解析,而是「錨定式二進位補丁」——
 * 以屬性名 FString("PlayerUId"/"InstanceId") + "StructProperty" + "Guid" 的
 * 位元組序列為錨點定位 Guid 值,驗證舊值完全符合才改寫。沒動到的位元組
 * 保證原封不動,避開了「整檔重新序列化必須 bit-exact」的風險。
 * 格式依據:cheahjs/palworld-save-tools 的 palsav.py(容器)與 archive.py(UUID 位元組序),
 * 已用該 repo 的真實測試存檔(共玩主機玩家檔 + Level.sav)驗證錨點命中。
 *
 * Scope: transfers the matching Guild character handle, leader, and roster entry
 * in addition to the player record and Pal ownership. Guild raw data is parsed
 * and fully validated before any ID is patched.
 */

/* ── 存檔容器:PlZ(zlib,舊版)與 PlM(Oodle,新版)── */

const MAGIC_ZLIB = "PlZ";
const MAGIC_OODLE = "PlM";

async function decompressSav(buf: Buffer): Promise<{ data: Buffer; saveType: number }> {
  let off = 0;
  let uncompressedLen = buf.readUInt32LE(0);
  let magic = buf.subarray(8, 11).toString("latin1");
  let saveType = buf[11];
  off = 12;
  if (magic === "CNK") {
    // 選配的 CNK 前綴:整組 header 後移 12 bytes
    uncompressedLen = buf.readUInt32LE(12);
    magic = buf.subarray(20, 23).toString("latin1");
    saveType = buf[23];
    off = 24;
  }
  if (magic === MAGIC_OODLE) {
    // 新版存檔:payload 是 Oodle 壓縮流(實測為 Mermaid)。只看過 0x31,其他值先擋。
    if (saveType !== 0x31) throw fail(`不支援的 PlM 存檔壓縮類型 0x${saveType.toString(16)}`, 422);
    const data = await oodleDecompress(buf.subarray(off), uncompressedLen);
    return { data, saveType };
  }
  if (magic !== MAGIC_ZLIB) throw fail(`不是 Palworld 存檔(magic=${JSON.stringify(magic)})`, 422);
  if (saveType !== 0x31 && saveType !== 0x32) throw fail(`不支援的存檔壓縮類型 0x${saveType.toString(16)}`, 422);
  let data = zlib.inflateSync(buf.subarray(off));
  if (saveType === 0x32) data = zlib.inflateSync(data);
  if (data.length !== uncompressedLen) throw fail("存檔長度驗證失敗,檔案可能已損毀", 422);
  return { data, saveType };
}

/** 寫回一律用 zlib 的 PlZ 容器 —— 即使來源是 PlM(Oodle):遊戲兩種都讀
 *  (歷次改版舊 PlZ 存檔都載得起來),這樣就不需要實作 Oodle 壓縮。 */
function compressSav(data: Buffer, saveType: number): Buffer {
  let comp = zlib.deflateSync(data);
  const compLen = comp.length;
  if (saveType === 0x32) comp = zlib.deflateSync(comp);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(data.length, 0);
  head.writeUInt32LE(compLen, 4);
  head.write(MAGIC_ZLIB, 8, "latin1");
  head[11] = saveType;
  return Buffer.concat([head, comp]);
}

/* ── UUID ↔ 位元組(archive.py 的 4-byte 區塊反轉序)── */

const UUID_BYTE_ORDER = [3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12] as const;

function uuidToRaw(s: string): Buffer {
  const hex = s.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw fail(`PlayerUid 格式不合法:${s}`, 422);
  const b = Buffer.from(hex, "hex");
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = b[UUID_BYTE_ORDER[i]];
  return out;
}

function rawToUuid(raw: Buffer): string {
  const b = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) b[UUID_BYTE_ORDER[i]] = raw[i];
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ── 錨定式 Guid 屬性掃描 ── */

/** GVAS FString:int32 長度(含結尾 \0)+ ascii bytes + \0。 */
function fstr(name: string): Buffer {
  const b = Buffer.alloc(4 + name.length + 1);
  b.writeInt32LE(name.length + 1, 0);
  b.write(name, 4, "latin1");
  return b;
}

const STRUCT_PROP = fstr("StructProperty");
const GUID_TYPE = fstr("Guid");

interface GuidProp {
  /** Guid 值(16 bytes)在 GVAS buffer 中的起始 offset。 */
  offset: number;
  uuid: string;
}

/** 找出所有「名為 propName 的 Guid 屬性」。
 *  錨點 = FString(propName) + FString("StructProperty") + u64 size(16) +
 *  FString("Guid") + 16B struct-guid + 1B flag,之後 16B 即為值。 */
function findGuidProps(data: Buffer, propName: string): GuidProp[] {
  const anchor = Buffer.concat([fstr(propName), STRUCT_PROP]);
  const out: GuidProp[] = [];
  let idx = 0;
  while ((idx = data.indexOf(anchor, idx)) !== -1) {
    let p = idx + anchor.length;
    idx += anchor.length;
    if (p + 8 + GUID_TYPE.length + 17 + 16 > data.length) continue;
    const size = Number(data.readBigUInt64LE(p));
    p += 8;
    if (size !== 16) continue;
    if (Buffer.compare(data.subarray(p, p + GUID_TYPE.length), GUID_TYPE) !== 0) continue;
    p += GUID_TYPE.length + 16 + 1; // struct guid(全零) + has-guid flag
    out.push({ offset: p, uuid: rawToUuid(data.subarray(p, p + 16)) });
  }
  return out;
}

interface ByteArrayProp {
  /** Start and length of a raw ByteProperty array's payload. */
  offset: number;
  length: number;
}

/** Locate an unlabelled ArrayProperty<ByteProperty> by its property name. */
function findByteArrayProps(data: Buffer, propName: string): ByteArrayProp[] {
  const anchor = Buffer.concat([fstr(propName), fstr("ArrayProperty")]);
  const byteType = fstr("ByteProperty");
  const out: ByteArrayProp[] = [];
  let idx = 0;
  while ((idx = data.indexOf(anchor, idx)) !== -1) {
    let p = idx + anchor.length;
    idx += anchor.length;
    if (p + 8 + byteType.length + 1 + 4 > data.length) continue;
    const size = Number(data.readBigUInt64LE(p));
    p += 8;
    if (Buffer.compare(data.subarray(p, p + byteType.length), byteType) !== 0) continue;
    p += byteType.length;
    const hasId = data[p++];
    if (hasId === 1) p += 16;
    else if (hasId !== 0) continue;
    if (p + 4 > data.length) continue;
    const length = data.readUInt32LE(p);
    p += 4;
    if (size !== length + 4 || p + length > data.length) continue;
    out.push({ offset: p, length });
  }
  return out;
}

/** Advance through an Unreal FString without decoding it. */
function skipFString(data: Buffer, offset: number, end: number): number | null {
  if (offset + 4 > end) return null;
  const length = data.readInt32LE(offset);
  if (length === 0) return offset + 4;
  const bytes = length > 0 ? length : -length * 2;
  const next = offset + 4 + bytes;
  return bytes > 0 && next <= end ? next : null;
}

interface GuildHandle {
  uidOffset: number;
  uid: Buffer;
  instance: Buffer;
}

interface GuildRecord {
  handles: GuildHandle[];
  adminOffset: number;
  memberOffsets: number[];
  metadataOffsets: number[];
}

/**
 * Decode the Guild RawData layouts supported by palsav-flex. The July 2026
 * format has an extended guild tail (roles, permissions, and markers); older
 * records use the legacy layout. A candidate is accepted only when it ends
 * exactly at the end of its RawData blob.
 */
function inspectGuildRawData(raw: Buffer): GuildRecord | null {
  const end = raw.length;
  const take = (state: { p: number }, bytes: number): number | null => {
    if (bytes < 0 || state.p + bytes > end) return null;
    const at = state.p;
    state.p += bytes;
    return at;
  };
  const readCount = (state: { p: number }, itemBytes: number): number | null => {
    if (state.p + 4 > end) return null;
    const count = raw.readUInt32LE(state.p);
    state.p += 4;
    return count <= Math.floor((end - state.p) / itemBytes) ? count : null;
  };
  const readHandles = (state: { p: number }): GuildHandle[] | null => {
    if (take(state, 16) === null) return null; // group_id
    const groupNameEnd = skipFString(raw, state.p, end);
    if (groupNameEnd === null) return null;
    state.p = groupNameEnd;
    const count = readCount(state, 32);
    if (count === null) return null;
    const handles: GuildHandle[] = [];
    for (let i = 0; i < count; i++) {
      const uidOffset = take(state, 16);
      const instanceOffset = take(state, 16);
      if (uidOffset === null || instanceOffset === null) return null;
      handles.push({
        uidOffset,
        uid: raw.subarray(uidOffset, uidOffset + 16),
        instance: raw.subarray(instanceOffset, instanceOffset + 16),
      });
    }
    if (take(state, 1) === null) return null; // org_type
    return handles;
  };
  const readPlayers = (state: { p: number }, withRole: boolean): number[] | null => {
    const count = readCount(state, withRole ? 25 : 24);
    if (count === null) return null;
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const uidOffset = take(state, 16);
      if (uidOffset === null || take(state, 8) === null) return null;
      const nameEnd = skipFString(raw, state.p, end);
      if (nameEnd === null) return null;
      state.p = nameEnd;
      if (withRole && take(state, 1) === null) return null;
      out.push(uidOffset);
    }
    return out;
  };
  const finishModernTail = (state: { p: number }, handles: GuildHandle[], metadataOffsets: number[]): GuildRecord | null => {
    const roles = readCount(state, 1);
    if (roles === null || take(state, roles) === null || take(state, 4) === null) return null;
    const adminOffset = take(state, 16);
    if (adminOffset === null) return null;
    const memberOffsets = readPlayers(state, true);
    if (memberOffsets === null) return null;
    const permissionCount = readCount(state, 5);
    if (permissionCount === null) return null;
    for (let i = 0; i < permissionCount; i++) {
      if (take(state, 1) === null) return null;
      const count = readCount(state, 1);
      if (count === null || take(state, count) === null) return null;
    }
    if (take(state, 4) === null || state.p !== end) return null;
    return { handles, adminOffset, memberOffsets, metadataOffsets };
  };
  const finishOldTail = (state: { p: number }, handles: GuildHandle[], metadataOffsets: number[]): GuildRecord | null => {
    const adminOffset = take(state, 16);
    if (adminOffset === null) return null;
    const memberOffsets = readPlayers(state, false);
    if (memberOffsets === null || take(state, 4) === null || state.p !== end) return null;
    return { handles, adminOffset, memberOffsets, metadataOffsets };
  };

  // Current palsav-flex guild layout (including the 2026-07 guild roles).
  {
    const state = { p: 0 };
    const handles = readHandles(state);
    if (handles) {
      const metadataOffsets: number[] = [];
      if (take(state, 4) !== null) { // leading_bytes
        const baseCount = readCount(state, 16);
        if (baseCount !== null && take(state, baseCount * 16) !== null && take(state, 8) !== null) {
          const pointsCount = readCount(state, 16);
          if (pointsCount !== null && take(state, pointsCount * 16) !== null) {
            const guildNameEnd = skipFString(raw, state.p, end);
            if (guildNameEnd !== null) {
              state.p = guildNameEnd;
              const lastModifier = take(state, 16);
              if (lastModifier !== null) {
                metadataOffsets.push(lastModifier);
                const markerCount = readCount(state, 60);
                if (markerCount !== null) {
                  let markersOk = true;
                  for (let i = 0; i < markerCount; i++) {
                    // FPalGuildMarkerData = marker Guid (16) + Vector (24) + type (4) + owner Guid (16).
                    if (take(state, 44) === null) {
                      markersOk = false;
                      break;
                    }
                    const markerOwner = take(state, 16);
                    if (markerOwner === null) {
                      markersOk = false;
                      break;
                    }
                    metadataOffsets.push(markerOwner);
                  }
                  if (markersOk) {
                    const modernStart = { p: state.p };
                    const modern = finishModernTail(modernStart, handles, metadataOffsets);
                    if (modern) return modern;
                    const old = finishOldTail({ p: state.p }, handles, metadataOffsets);
                    if (old) return old;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Legacy Guild layout retained for old worlds.
  {
    const state = { p: 0 };
    const handles = readHandles(state);
    if (handles) {
      const baseCount = readCount(state, 16);
      if (baseCount !== null && take(state, baseCount * 16) !== null && take(state, 4) !== null) {
        const pointsCount = readCount(state, 16);
        if (pointsCount !== null && take(state, pointsCount * 16) !== null) {
          const guildNameEnd = skipFString(raw, state.p, end);
          if (guildNameEnd !== null) {
            state.p = guildNameEnd;
            const old = finishOldTail(state, handles, []);
            if (old) return old;
          }
        }
      }
    }
  }
  return null;
}

function sameRawId(a: Buffer, b: Buffer): boolean {
  return Buffer.compare(a, b) === 0;
}

function patchGuildOwnership(
  data: Buffer,
  oldRaw: Buffer,
  newRaw: Buffer,
  instanceRaws: readonly Buffer[],
): { patchedGuildHandles: number; patchedGuildAdmins: number; patchedGuildMembers: number } {
  let patchedGuildHandles = 0;
  let patchedGuildAdmins = 0;
  let patchedGuildMembers = 0;
  for (const prop of findByteArrayProps(data, "RawData")) {
    const raw = data.subarray(prop.offset, prop.offset + prop.length);
    const guild = inspectGuildRawData(raw);
    if (!guild) continue;
    const handles = guild.handles.filter((h) => sameRawId(h.uid, oldRaw) && instanceRaws.some((i) => sameRawId(h.instance, i)));
    if (handles.length === 0) continue;
    for (const handle of handles) {
      newRaw.copy(raw, handle.uidOffset);
      patchedGuildHandles += 1;
    }
    if (sameRawId(raw.subarray(guild.adminOffset, guild.adminOffset + 16), oldRaw)) {
      newRaw.copy(raw, guild.adminOffset);
      patchedGuildAdmins += 1;
    }
    for (const offset of [...guild.memberOffsets, ...guild.metadataOffsets]) {
      if (sameRawId(raw.subarray(offset, offset + 16), oldRaw)) {
        newRaw.copy(raw, offset);
        if (guild.memberOffsets.includes(offset)) patchedGuildMembers += 1;
      }
    }
  }
  return { patchedGuildHandles, patchedGuildAdmins, patchedGuildMembers };
}

function matchingLevelPlayerUidOffsets(data: Buffer, playerUid: string, instanceRaw: Buffer): number[] {
  const playerUids = findGuidProps(data, "PlayerUId").filter((p) => p.uuid === playerUid);
  const instances = findGuidProps(data, "InstanceId").filter((p) => sameRawId(data.subarray(p.offset, p.offset + 16), instanceRaw));
  // Recent saves can serialize InstanceId before PlayerUId and may insert new
  // fields between them. Restrict the match to the same nearby map entry.
  const nearby = playerUids.filter((uid) => instances.some((instance) => Math.abs(instance.offset - uid.offset) <= 4096));
  // A PlayerUid is normally unique in Level.sav. If its adjacent InstanceId is
  // no longer serialized in the old layout, the unique PlayerUid remains a
  // safer target than abandoning a recoverable transfer.
  return nearby.length > 0 ? nearby.map((p) => p.offset) : playerUids.length === 1 ? [playerUids[0].offset] : [];
}

function playerInstanceRaws(data: Buffer, playerUid: string): Buffer[] {
  const playerUids = findGuidProps(data, "PlayerUId").filter((p) => p.uuid === playerUid);
  const allInstances = findGuidProps(data, "InstanceId");
  const seen = new Set<string>();
  const out: Buffer[] = [];
  for (const uid of playerUids) {
    for (const instance of allInstances) {
      if (Math.abs(instance.offset - uid.offset) > 4096) continue;
      const raw = data.subarray(instance.offset, instance.offset + 16);
      const key = raw.toString("hex");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(raw);
      }
    }
  }
  return out;
}

function fail(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

const SAV_NAME_RE = /^[0-9A-Fa-f]{32}\.sav$/;

/** 檔名(32 hex).sav → 連字號小寫 uuid 字串。 */
function savNameToUuid(name: string): string {
  const h = name.slice(0, 32).toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * 執行主機角色修復。呼叫端負責:確認伺服器已停止、先做備份。
 * @param worldDir 世界資料夾(…/SaveGames/0/<guid>)
 * @param oldSavName 舊角色檔名(通常 00000000…0001.sav)
 * @param newSavName 新角色檔名(該玩家加入專用伺服器後產生的)
 */
export async function applyHostFix(
  worldDir: string,
  oldSavName: string,
  newSavName: string,
): Promise<Omit<HostFixResult, "backup">> {
  if (!SAV_NAME_RE.test(oldSavName) || !SAV_NAME_RE.test(newSavName)) {
    throw fail("Player save filename is invalid", 422);
  }
  if (oldSavName.toLowerCase() === newSavName.toLowerCase()) {
    throw fail("The source and target character saves are the same", 422);
  }
  const playersDir = path.join(worldDir, "Players");
  const oldPath = path.join(playersDir, oldSavName);
  const newPath = path.join(playersDir, newSavName);
  const levelPath = path.join(worldDir, "Level.sav");
  if (!fs.existsSync(oldPath)) throw fail(`Source player save ${oldSavName} was not found`, 404);
  if (!fs.existsSync(newPath)) {
    throw fail(`Target player save ${newSavName} was not found. The player must join this server once first.`, 404);
  }
  if (!fs.existsSync(levelPath)) throw fail("Level.sav was not found", 404);

  const oldUid = savNameToUuid(oldSavName);
  const newUid = savNameToUuid(newSavName);
  const oldRaw = uuidToRaw(oldUid);
  const newRaw = uuidToRaw(newUid);

  // ── 玩家檔:改 SaveData.PlayerUId 與 SaveData.IndividualId.PlayerUId(恰 2 處),
  //    並讀出 IndividualId.InstanceId 當 Level.sav 的比對錨。
  const oldPlayer = await decompressSav(fs.readFileSync(oldPath));
  const uidProps = findGuidProps(oldPlayer.data, "PlayerUId");
  const matching = uidProps.filter((p) => p.uuid === oldUid);
  if (uidProps.length !== 2 || matching.length !== 2) {
    throw fail(
      `Source player save has unexpected PlayerUId fields (found ${uidProps.length}; ${matching.length} match ${oldUid}). The transfer was cancelled to protect the save.`,
      422,
    );
  }
  const instProps = findGuidProps(oldPlayer.data, "InstanceId");
  if (instProps.length !== 1) {
    throw fail(`Source player save has an unexpected InstanceId field count (${instProps.length}). The transfer was cancelled to protect the save.`, 422);
  }
  const instanceUid = instProps[0].uuid;
  const instRaw = uuidToRaw(instanceUid);
  for (const p of matching) newRaw.copy(oldPlayer.data, p.offset);

  // Level.sav links the character by PlayerUId and InstanceId. Both field
  // order and spacing changed in recent saves, so match either nearby order.
  const level = await decompressSav(fs.readFileSync(levelPath));
  const targets = matchingLevelPlayerUidOffsets(level.data, oldUid, instRaw);
  if (targets.length !== 1) {
    throw fail(
      `Level.sav has ${targets.length} matching entries for this character (InstanceId=${instanceUid}; expected 1). The transfer was cancelled to protect the save.`,
      422,
    );
  }
  newRaw.copy(level.data, targets[0]);
  void oldRaw; // 舊值已由 matching 過濾驗證

  // ── 帕魯過戶:CharacterSaveParameterMap 裡帕魯的 OwnerPlayerUId 還掛在舊 uid 上
  //    (擁有者顯示、統計歸屬、以及清理類工具的歸屬判斷都看這個欄位)。
  //    OwnerPlayerUId 是具名 GVAS 屬性,可用與 PlayerUId 相同的錨點安全定位;
  //    只改「值 == 舊 uid」的,一隻不多一隻不少。
  //    (OldOwnerPlayerUIds 是歷史紀錄陣列,元素無具名錨點且不影響行為,不動。)
  const owners = findGuidProps(level.data, "OwnerPlayerUId").filter((p) => p.uuid === oldUid);
  for (const p of owners) newRaw.copy(level.data, p.offset);

  // Guilds own base camps. Move the matching character handle, guild leader,
  // and roster member from the old player ID to the new one. The group blob is
  // fully validated before it is changed; unrelated guilds stay untouched.
  const guild = patchGuildOwnership(level.data, oldRaw, newRaw, [instRaw]);

  // ── 寫回:玩家檔內容落到 <新Uid>.sav(覆蓋加入時產生的空角色),刪舊檔;Level.sav 原地覆寫。
  fs.writeFileSync(newPath, compressSav(oldPlayer.data, oldPlayer.saveType));
  fs.rmSync(oldPath, { force: true });
  fs.writeFileSync(levelPath, compressSav(level.data, level.saveType));

  return {
    oldUid,
    newUid,
    patchedLevelEntries: targets.length,
    patchedPalOwners: owners.length,
    ...guild,
  };
}

/**
 * Repair guild/base ownership after a character transfer that was already
 * completed. The old player file is gone, so the source ID is inferred only
 * from a guild character handle that points to one of the active player's
 * Level.sav character instances. Ambiguous worlds are rejected safely.
 */
export async function repairTransferredGuildOwnership(
  worldDir: string,
  toSavName: string,
): Promise<{
  oldUid: string;
  newUid: string;
  patchedGuildHandles: number;
  patchedGuildAdmins: number;
  patchedGuildMembers: number;
}> {
  if (!SAV_NAME_RE.test(toSavName)) throw fail("Target player save filename is invalid", 422);
  const newUid = savNameToUuid(toSavName);
  const targetPath = path.join(worldDir, "Players", toSavName);
  const levelPath = path.join(worldDir, "Level.sav");
  if (!fs.existsSync(targetPath)) throw fail("Target player save " + toSavName + " was not found", 404);
  if (!fs.existsSync(levelPath)) throw fail("Level.sav was not found", 404);

  const level = await decompressSav(fs.readFileSync(levelPath));
  const instances = playerInstanceRaws(level.data, newUid);
  if (instances.length === 0) {
    throw fail("Could not find this player's Level.sav character record. Run a save scan after the player has joined once.", 422);
  }
  const newRaw = uuidToRaw(newUid);
  const candidates = new Map<string, Buffer>();
  for (const prop of findByteArrayProps(level.data, "RawData")) {
    const raw = level.data.subarray(prop.offset, prop.offset + prop.length);
    const guild = inspectGuildRawData(raw);
    if (!guild) continue;
    for (const handle of guild.handles) {
      if (!sameRawId(handle.uid, newRaw) && instances.some((instance) => sameRawId(handle.instance, instance))) {
        candidates.set(handle.uid.toString("hex"), Buffer.from(handle.uid));
      }
    }
  }
  if (candidates.size !== 1) {
    throw fail(
      candidates.size === 0
        ? "Could not identify the old guild owner for this transferred character. Restore the automatic pre-transfer backup and run the transfer again."
        : "More than one old guild owner matches this character. Restore the automatic pre-transfer backup and run the transfer again.",
      422,
    );
  }
  const oldRaw = [...candidates.values()][0];
  const patch = patchGuildOwnership(level.data, oldRaw, newRaw, instances);
  if (patch.patchedGuildHandles === 0) {
    throw fail("No matching guild character handle was changed", 422);
  }
  fs.writeFileSync(levelPath, compressSav(level.data, level.saveType));
  return { oldUid: rawToUuid(oldRaw), newUid, ...patch };
}

/**
 * 獨立的帕魯歸屬過戶:把 Level.sav 裡「OwnerPlayerUId == fromUid」的帕魯全部
 * 過戶給 toUid。給「主機角色已修復(或重建),但帕魯還掛在共玩殘留 uid」的世界用
 * —— 這種情況舊角色檔已不存在,applyHostFix 跑不了。
 * 呼叫端負責:確認伺服器已停止、先做備份。
 */
export async function transferPalOwners(
  worldDir: string,
  fromUid: string,
  toSavName: string,
): Promise<{ fromUid: string; toUid: string; patchedPalOwners: number }> {
  if (!SAV_NAME_RE.test(toSavName)) throw fail("目標Player save filename is invalid", 422);
  const toUid = savNameToUuid(toSavName);
  if (fromUid.toLowerCase() === toUid.toLowerCase()) throw fail("來源與目標相同,不需過戶", 422);
  const toPath = path.join(worldDir, "Players", toSavName);
  if (!fs.existsSync(toPath)) throw fail(`找不到目標玩家存檔 ${toSavName}`, 404);
  const levelPath = path.join(worldDir, "Level.sav");
  if (!fs.existsSync(levelPath)) throw fail("Level.sav was not found", 404);

  const level = await decompressSav(fs.readFileSync(levelPath));
  const owners = findGuidProps(level.data, "OwnerPlayerUId").filter((p) => p.uuid === fromUid.toLowerCase());
  if (owners.length === 0) {
    throw fail(`Level.sav has no Pals owned by ${fromUid}; nothing needs to be transferred`, 404);
  }
  const toRaw = uuidToRaw(toUid);
  for (const p of owners) toRaw.copy(level.data, p.offset);
  fs.writeFileSync(levelPath, compressSav(level.data, level.saveType));

  return { fromUid, toUid, patchedPalOwners: owners.length };
}
