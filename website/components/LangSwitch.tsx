'use client';

import { locales, localeName, type Locale } from '@/i18n/config';

/**
 * 語言切換:靜態匯出沒有 router,直接用 <a> 換到 /<locale> 並保留目前的 hash(錨點),
 * 這樣切語言不會跳回頁首。當前語言標成 aria-current。
 */
export default function LangSwitch({ current }: { current: Locale }) {
  const go = (l: Locale) => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    return `/${l}/${hash}`;
  };
  return (
    <div className="lang" role="group" aria-label="Language">
      {locales.map((l) => (
        <a
          key={l}
          href={go(l)}
          className={l === current ? 'on' : ''}
          aria-current={l === current ? 'true' : undefined}
          hrefLang={l}
        >
          {localeName[l]}
        </a>
      ))}
    </div>
  );
}
