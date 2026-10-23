const { buildSecurityHeaders } = require('./config/securityHeaders');
const { checkWebEnv } = require('./config/checkWebEnv');

// Fail a bad deploy at build time instead of shipping a site that cannot log in
// or reach the game server. Strict on Vercel (or with CHECK_ENV_STRICT=true);
// locally it only prints, so `npm run dev` still starts with a half-filled
// .env.local. A service role key in a NEXT_PUBLIC_ variable is always fatal.
const strict = Boolean(process.env.VERCEL) || process.env.CHECK_ENV_STRICT === 'true';
const envReport = checkWebEnv(process.env);

if (envReport.fatalAlways.length > 0) {
  throw new Error(`Refusing to build:\n - ${envReport.fatalAlways.join('\n - ')}`);
}
if (envReport.errors.length > 0) {
  const text = `Environment problems:\n - ${envReport.errors.join('\n - ')}`;
  if (strict) throw new Error(`Refusing to build. ${text}`);
  console.warn(`[env] ${text}\n[env] (only a warning here; the build fails on Vercel)`);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework and version in every response.
  poweredByHeader: false,
  // The app does not use next/image. Turning the optimizer off removes the
  // /_next/image endpoint, the target of several Next.js advisories.
  images: { unoptimized: true },
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders(process.env) }];
  },
};

module.exports = nextConfig;
