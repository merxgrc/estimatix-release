import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude native / worker-dependent packages from webpack bundling so they
  // resolve from node_modules at runtime (these break when webpack bundles them).
  serverExternalPackages: [
    'pdfjs-dist',
    'pdf-parse',
    'canvas',
    '@sparticuz/chromium',
    'playwright-core',
  ],
  // Ensure Vercel includes pdf-parse (and its nested pdfjs-dist) in the deployment
  outputFileTracingIncludes: {
    '/api/plans/parse': ['./node_modules/pdf-parse/**/*'],
  },
};

export default nextConfig;
