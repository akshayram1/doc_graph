import type { NextConfig } from 'next';
import fs from 'fs';
import path from 'path';
import { loadEnvConfig } from '@next/env';

function findRoot(): string {
  const start = process.cwd();
  const candidates = [start, path.resolve(start, '..'), path.resolve(start, '../..')];

  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, '.env')) &&
      fs.existsSync(path.join(dir, 'backend')) &&
      fs.existsSync(path.join(dir, 'frontend'))
    ) {
      return dir;
    }
  }

  return path.resolve(start, '..');
}

const rootDir = findRoot();
const { combinedEnv } = loadEnvConfig(rootDir);
const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL ||
  combinedEnv.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1:8000'
).replace(/\/$/, '');

const nextConfig: NextConfig = {
  outputFileTracingRoot: rootDir,
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/health', destination: `${apiUrl}/health` },
    ];
  },
};

export default nextConfig;
