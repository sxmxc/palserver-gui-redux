import type { MetadataRoute } from 'next';
import { locales } from '@/i18n/config';

export const dynamic = 'force-static';

const SITE = 'https://palserver-gui.iosoftware.ai';
const languages = { 'zh-Hant': `${SITE}/zh/`, en: `${SITE}/en/`, ja: `${SITE}/ja/`, 'x-default': `${SITE}/zh/` };

export default function sitemap(): MetadataRoute.Sitemap {
  return locales.map((lang) => ({
    url: `${SITE}/${lang}/`,
    lastModified: new Date('2026-07-11'),
    changeFrequency: 'weekly',
    priority: lang === 'zh' ? 1 : 0.8,
    alternates: { languages },
  }));
}
