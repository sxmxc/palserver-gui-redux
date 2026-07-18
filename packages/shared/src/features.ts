/**
 * Feature availability helpers shared by the agent and web app.
 *
 * All features are available to every installation. The license status shape is
 * retained for backwards-compatible API responses while older agents update.
 */

export interface EarlyAccessFeature {
  id: string;
  label: string;
}

export const EARLY_ACCESS_FEATURES: EarlyAccessFeature[] = [];

/** Every feature is available without a license. */
export function featureFreeNow(_id: string): boolean {
  return true;
}

/** agent 回報給前端的授權狀態。 */
export interface LicenseStatus {
  /** 使用者是否已填識別碼。 */
  hasKey: boolean;
  /** 識別碼目前是否有效(含離線寬限期內)。 */
  valid: boolean;
  tier: string | null;
  /** 這張識別碼解鎖的早鳥功能 id。 */
  features: string[];
  /** 到期日(ISO)或 null=永久。 */
  expiresAt: string | null;
  /** 無效原因:invalid / bound-to-another / expired / offline / server-error。 */
  reason: string | null;
  /** 這台伺服器的機器碼(短)—— 識別碼一旦啟用就綁這台。 */
  machineId: string;
  /** 上次向伺服器驗證的時間(ISO);離線時前端可提示。 */
  checkedAt: string | null;
}

/** Unified feature availability check retained as a stable API for callers. */
export function hasFeature(_id: string, _lic: Pick<LicenseStatus, "valid" | "features">): boolean {
  return true;
}
