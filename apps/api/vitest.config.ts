import { defineConfig } from 'vitest/config';
import path from 'path';
import { readFileSync } from 'fs';

// Parse .env from repo root and inject into process.env before tests run
function loadEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, '../../.env');
  try {
    const content = readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

const envVars = loadEnv();
// Set env vars so NestJS ConfigModule picks them up
for (const [key, value] of Object.entries(envVars)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/main.ts'],
    },
  },
  resolve: {
    alias: {
      '@compensation/database': path.resolve(__dirname, '../../packages/database/dist/index.js'),
      '@compensation/shared': path.resolve(__dirname, '../../packages/shared/dist/index.js'),
      '@compensation/ai': path.resolve(__dirname, '../../packages/ai/dist/index.js'),
    },
  },
});

