import '../globals.css';
import type { Metadata } from 'next';

// 「/」語言導向頁專用的 root layout(route group,不影響網址)。
// 正式內容頁的 <html lang> 由 app/[lang]/layout.tsx 依語系輸出。
export const metadata: Metadata = {
  metadataBase: new URL('https://palserver-gui.iosoftware.ai'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
