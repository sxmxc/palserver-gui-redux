import fs from "node:fs";
import path from "node:path";
import selfsigned from "selfsigned";
import { DATA_DIR } from "./env.js";

export interface TlsCert {
  key: string;
  cert: string;
}

/**
 * 載入或自動生成 TLS 憑證(PALSERVER_TLS=1 時)。玩家可把自己的真憑證
 * (例如 Let's Encrypt)放進 data-dir/tls/{key.pem,cert.pem};沒有的話自動
 * 生成 10 年期自簽憑證。自簽憑證瀏覽器會跳警告(需手動信任),適合 VPN/區網
 * 內想再加一層加密的情況;要讓公開 https 網站直連,仍需一張受信任的真憑證。
 */
export async function loadOrCreateTlsCert(): Promise<TlsCert> {
  const dir = path.join(DATA_DIR, "tls");
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return { key: fs.readFileSync(keyFile, "utf8"), cert: fs.readFileSync(certFile, "utf8") };
  }
  const pems = await selfsigned.generate([{ name: "commonName", value: "palserver-agent" }], {
    days: 3650,
    keySize: 2048,
    algorithm: "sha256",
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}
