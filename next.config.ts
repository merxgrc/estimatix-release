import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude native / worker-dependent packages from webpack bundling so they
  // resolve from node_modules at runtime.
  // NOTE: pdf-parse is NOT externalized — webpack bundles it so Vercel includes it.
  serverExternalPackages: [
    'pdfjs-dist',
    'canvas',
    '@sparticuz/chromium',
    'playwright-core',
  ],
};

export default nextConfig;
