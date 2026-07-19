import { useState } from "react";
import { FiAlertTriangle, FiCheck, FiTool, FiX } from "react-icons/fi";
import { COOP_HOST_UID, type HostFixResult, type WorldSave } from "@palserver/shared";
import type { AgentClient } from "./api";
import { t, useI18n } from "./i18n";
import { Overlay } from "./ui";
import { btn, btnGhost, card, errorCls } from "./ui";

/**
 * 主機角色修復(內建 palworld-host-save-fix):共玩存檔搬上專用伺服器後,
 * 把綁在通用 ID(0000…0001)上的主機角色過戶給玩家在這台伺服器的新角色檔。
 */
export function HostFixModal({
  client,
  instanceId,
  world,
  running,
  onClose,
  onDone,
}: {
  client: AgentClient;
  instanceId: string;
  world: WorldSave;
  running: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  useI18n();
  const hostSav = world.playerSaves.find((p) => p.playerUid === COOP_HOST_UID) ?? null;
  // 「匯入後新增」的檔案排最前(共玩搬家時幾乎就是主機的新角色檔),其次照時間新→舊。
  const candidates = world.playerSaves
    .filter((p) => p.playerUid !== COOP_HOST_UID)
    .sort(
      (a, b) =>
        Number(b.newSinceImport ?? false) - Number(a.newSinceImport ?? false) ||
        (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""),
    );
  const defaultTarget = candidates.find((p) => p.newSinceImport) ?? candidates[0] ?? null;
  const defaultSource =
    candidates.find((p) => !p.newSinceImport && p.file !== defaultTarget?.file) ??
    candidates.find((p) => p.file !== defaultTarget?.file) ??
    null;
  const [source, setSource] = useState<string | null>(hostSav?.file ?? defaultSource?.file ?? null);
  const [picked, setPicked] = useState<string | null>(defaultTarget?.file ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<HostFixResult | null>(null);

  const repairGuild = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.repairGuildOwnership(instanceId, world.guid, picked);
      setDone({ ...r, patchedLevelEntries: 0, patchedPalOwners: 0 });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!source || !picked || source === picked) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.hostFix(instanceId, world.guid, source, picked);
      setDone(r);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div
        className={`${card} flex max-h-[86vh] w-150 max-w-full flex-col gap-3 overflow-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-lg font-extrabold">
            <FiTool className="size-5 text-pal" /> {t(hostSav ? "修復主機角色" : "移轉匯入玩家角色")}
          </h2>
          <button className="text-ink-muted transition hover:text-ink" onClick={onClose} aria-label={t("關閉")}>
            <FiX className="size-5" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col gap-3">
            <p className="inline-flex items-center gap-2 text-[15px] font-bold text-grass">
              <FiCheck className="size-5" /> {t(hostSav ? "修復完成!主機角色已過戶給新 ID。" : "移轉完成!原本角色已過戶給新 ID。")}
            </p>
            {done.patchedPalOwners > 0 && (
              <p className="text-[13px] text-ink-muted">
                {t("已一併把 {n} 隻帕魯的擁有者過戶到新 ID(修掉共玩殘留的歸屬)。", { n: done.patchedPalOwners })}
              </p>
            )}
            {done.patchedGuildHandles + done.patchedGuildAdmins + done.patchedGuildMembers > 0 && (
              <p className="text-[13px] text-ink-muted">
                {t("已一併移轉公會角色、成員與會長資料，讓原本公會擁有的據點繼續歸你使用。")}
              </p>
            )}
            <p className="text-[13px] text-ink-muted">
              {t("修復前已自動備份:{backup}(出問題可在下方備份清單一鍵還原)。", { backup: done.backup })}
            </p>
            <p className="text-[13px] text-ink-muted">
              {t("啟動伺服器,該玩家就能用原本的角色進來了。若公會顯示異常,讓該玩家退出公會再重新加入即可。")}
            </p>
            <button className={`${btn} self-start`} onClick={onClose}>
              {t("完成")}
            </button>
          </div>
        ) : (
          <>
            {hostSav ? (
              <>
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  {t("本機共玩存檔的主機角色綁在通用 ID(0000…0001)上,專用伺服器認不得,所以主機玩家進來會被要求重建角色。這個工具把舊角色的資料過戶給你在這台伺服器的新角色。")}
                </p>
                <ol className="flex list-inside list-decimal flex-col gap-1 text-[13px] text-ink-muted">
                  <li>{t("啟動伺服器,主機玩家用自己的帳號加入一次(會產生一個新的空角色檔)")}</li>
                  <li>{t("停止伺服器")}</li>
                  <li>{t("在下面選出那個新角色檔,執行修復")}</li>
                </ol>
              </>
            ) : (
              <p className="text-[13px] leading-relaxed text-ink-muted">
                {t("選擇匯入的原本角色與你加入新伺服器後建立的角色。移轉會保留原本角色的資料、帕魯歸屬，並更新 Level.sav 對應；執行前會自動備份。")}
              </p>
            )}

            {running && <p className={errorCls}>{t("伺服器正在運行 — 請先停止再執行修復。")}</p>}

            {!hostSav ? (
              candidates.length === 0 ? (
                <p className={errorCls}>{t("至少要有原本角色與新建立的角色各一個，才能移轉。")}</p>
              ) : candidates.length === 1 ? (
                <>
                  <p className="text-[13px] leading-relaxed text-ink-muted">
                    {t("角色已移轉，但據點仍在原本公會時，用這個修復。它會找出仍指向目前角色的舊公會資料，把據點、公會成員與會長歸屬移到你身上；執行前會自動備份。")}
                  </p>
                  <p className="font-mono text-xs font-bold break-all">{candidates[0].playerUid}</p>
                  {error && <p className={errorCls}>{error}</p>}
                  <div className="flex gap-2">
                    <button className={btn + " inline-flex items-center gap-1.5"} onClick={repairGuild} disabled={busy || running || !picked}>
                      <FiTool className="size-4" /> {busy ? t("修復中…") : t("修復公會與據點歸屬")}
                    </button>
                    <button className={btnGhost} onClick={onClose} disabled={busy}>{t("取消")}</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[13px] font-bold text-ink-muted">{t("原本的角色(要保留)")}</p>
                  <div className="flex flex-col gap-1.5">
                    {candidates.map((p) => (
                      <label
                        key={p.file}
                        className={`flex cursor-pointer items-center gap-3 rounded-cute border-2 px-3 py-2 transition ${
                          source === p.file ? "border-pal bg-pal/5" : "border-line hover:border-ink-muted"
                        }`}
                      >
                        <input type="radio" name="importsourcesav" checked={source === p.file} onChange={() => setSource(p.file)} />
                        <span className="flex-1">
                          <span className="block font-mono text-xs font-bold break-all">{p.playerUid}</span>
                          <span className="block text-xs text-ink-muted">
                            {(p.sizeBytes / 1024).toFixed(0)} KB
                            {p.modifiedAt ? ` · ${new Date(p.modifiedAt).toLocaleString()}` : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[13px] font-bold text-ink-muted">{t("新建立的角色(會被取代)")}</p>
                  <div className="flex flex-col gap-1.5">
                    {candidates.filter((p) => p.file !== source).map((p) => (
                      <label
                        key={p.file}
                        className={`flex cursor-pointer items-center gap-3 rounded-cute border-2 px-3 py-2 transition ${
                          picked === p.file ? "border-pal bg-pal/5" : "border-line hover:border-ink-muted"
                        }`}
                      >
                        <input type="radio" name="importtargetsav" checked={picked === p.file} onChange={() => setPicked(p.file)} />
                        <span className="flex-1">
                          <span className="block font-mono text-xs font-bold break-all">{p.playerUid}</span>
                          <span className="block text-xs text-ink-muted">
                            {(p.sizeBytes / 1024).toFixed(0)} KB
                            {p.modifiedAt ? ` · ${new Date(p.modifiedAt).toLocaleString()}` : ""}
                          </span>
                        </span>
                        {p.newSinceImport && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-grass/15 px-2 py-0.5 text-xs font-bold text-grass">
                            <FiCheck className="size-3" /> {t("匯入後新增")}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                  <p className="inline-flex items-start gap-2 text-xs text-ink-muted">
                    <FiAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-sun" />
                    {t("移轉會覆蓋所選的新角色檔並刪除原本角色檔；執行前會自動備份整個世界，出問題可一鍵還原。")}
                  </p>
                  {error && <p className={errorCls}>{error}</p>}
                  <div className="flex gap-2">
                    <button
                      className={`${btn} inline-flex items-center gap-1.5`}
                      onClick={run}
                      disabled={busy || running || !source || !picked || source === picked}
                    >
                      <FiTool className="size-4" /> {busy ? t("移轉中…") : t("執行移轉")}
                    </button>
                    <button className={btnGhost} onClick={onClose} disabled={busy}>
                      {t("取消")}
                    </button>
                  </div>
                </>
              )
            ) : candidates.length === 0 ? (
              <p className="rounded-xl border-2 border-sun/40 bg-sun/10 px-3 py-2 text-[13px] text-sun">
                {t("還沒有其他玩家角色檔 — 先完成上面的步驟 1(主機玩家加入伺服器一次),再回來執行修復。")}
              </p>
            ) : (
              <>
                <p className="text-[13px] font-bold text-ink-muted">{t("主機玩家的新角色檔(通常是最新的那個)")}</p>
                <div className="flex flex-col gap-1.5">
                  {candidates.map((p) => (
                    <label
                      key={p.file}
                      className={`flex cursor-pointer items-center gap-3 rounded-cute border-2 px-3 py-2 transition ${
                        picked === p.file ? "border-pal bg-pal/5" : "border-line hover:border-ink-muted"
                      }`}
                    >
                      <input type="radio" name="newsav" checked={picked === p.file} onChange={() => setPicked(p.file)} />
                      <span className="flex-1">
                        <span className="block font-mono text-xs font-bold break-all">{p.playerUid}</span>
                        <span className="block text-xs text-ink-muted">
                          {(p.sizeBytes / 1024).toFixed(0)} KB
                          {p.modifiedAt ? ` · ${new Date(p.modifiedAt).toLocaleString()}` : ""}
                        </span>
                      </span>
                      {p.newSinceImport && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-grass/15 px-2 py-0.5 text-xs font-bold text-grass">
                          <FiCheck className="size-3" /> {t("匯入後新增")}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                <p className="inline-flex items-start gap-2 text-xs text-ink-muted">
                  <FiAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-sun" />
                  {t("修復會覆蓋所選的新角色檔並刪除舊主機檔;執行前會自動備份整個世界,出問題可一鍵還原。")}
                </p>
                {error && <p className={errorCls}>{error}</p>}
                <div className="flex gap-2">
                  <button
                    className={`${btn} inline-flex items-center gap-1.5`}
                    onClick={run}
                    disabled={busy || running || !picked}
                  >
                    <FiTool className="size-4" /> {busy ? t("修復中…") : t("執行修復")}
                  </button>
                  <button className={btnGhost} onClick={onClose} disabled={busy}>
                    {t("取消")}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Overlay>
  );
}
