import { useEffect, useState } from "react";
import { FiX, FiShield, FiDownload, FiUser, FiUsers, FiServer, FiPlay } from "react-icons/fi";
import { Markdown } from "./Markdown";
import { fetchGlobalStats, type GlobalStats } from "./stats";
import { t, useI18n } from "./i18n";
import { Overlay, card, btn } from "./ui";

/**
 * 隱私權政策彈窗:顯示 /privacy.md 的政策全文,並附上全球匿名統計的即時總數
 * (資料透明 —— 讓使用者看到我們到底收了什麼、長什麼樣)。
 * 遙測開關在「設定」裡(需要已連線的 agent),這裡純資訊。
 */
export function PrivacyModal({ onClose }: { onClose: () => void }) {
  useI18n();
  const [policy, setPolicy] = useState<string | null>(null);
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    fetch("/privacy.md", { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setPolicy)
      .catch(() => setPolicy(t("讀取失敗 —— 政策全文請見 GitHub repo 的 PRIVACY.md。")));
    void fetchGlobalStats().then(setStats);
  }, []);

  return (
    <Overlay onClose={onClose}>
      <div
        className={`${card} flex max-h-[85vh] w-[560px] max-w-full flex-col gap-3`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-lg font-extrabold">
            <FiShield className="size-5 text-pal" /> {t("隱私權政策")}
          </h2>
          <button className="text-ink-muted transition hover:text-ink" onClick={onClose} aria-label={t("關閉")}>
            <FiX className="size-5" />
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat icon={<FiDownload />} label={t("總下載")} value={stats.downloads} />
            <Stat icon={<FiUser />} label={t("管理者")} value={stats.admins} />
            <Stat icon={<FiServer />} label={t("伺服器建立")} value={stats.instancesCreated} />
            <Stat icon={<FiPlay />} label={t("啟動次數")} value={stats.serverStarts} />
            <Stat icon={<FiUsers />} label={t("玩家")} value={stats.players} />
          </div>
        )}

        <div className="overflow-y-auto pr-1 text-[13px]">
          {policy === null ? <p className="text-ink-muted">{t("載入中…")}</p> : <Markdown source={policy} />}
        </div>

        <div className="flex justify-end">
          <button className={btn} onClick={onClose}>
            {t("我知道了")}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl bg-card-soft px-2 py-2 text-center">
      <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
        <span className="[&>svg]:size-3.5">{icon}</span>
        {label}
      </span>
      <span className="text-sm font-extrabold">{value === null ? "—" : value.toLocaleString()}</span>
    </div>
  );
}
