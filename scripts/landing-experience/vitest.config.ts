import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['scripts/landing-experience/transport.test.ts'] } });
