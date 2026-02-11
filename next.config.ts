import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude native / worker-dependent packages from webpack bundling so they
  // resolve from node_modules at runtime (fixes pdfjs worker & pdf-parse).
  serverExternalPackages: [
    'pdfjs-dist',
    'pdf-parse',
    'canvas',
    '@sparticuz/chromium',
    'playwright-core',
  ],
};

export default nextConfig;
