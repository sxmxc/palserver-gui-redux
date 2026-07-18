/** @type {import('next').NextConfig} */
const nextConfig = {
  // 純靜態匯出:next build 直接產出 out/,任何靜態主機都能 serve。
  output: 'export',
  // 產出 /zh/index.html 這種目錄式結構,靜態主機靠「目錄索引」就能對應 /zh/,
  // 不必依賴主機把 /zh 自動補成 /zh.html。
  trailingSlash: true,
  images: { unoptimized: true },
  // monorepo 根目錄有 pnpm-lock.yaml,明確指定以 website/ 為根, 避免誤判。
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
