import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_SECRET: "dev-secret-change-in-production-min-32-chars!!",
    },
    // Mocks the token-version (revocation) check for all route tests.
    setupFiles: ["./src/test/vitest.setup.ts"],
  },
});
