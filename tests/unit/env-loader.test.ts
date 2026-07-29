import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import { loadLocalEnv, parseEnvFile } from "../../src/server/config/env.ts";

describe("local env loader", () => {
  it("parses quoted values, empty values and inline comments", () => {
    const values = parseEnvFile([
      "DATA_DIR=./data",
      "BANGUMI_USER_AGENT=\"anime-quarter-schedule-local/0.1.0 (contact: local-dev)\"",
      "BAHAMUT_TIMETABLE_URLS= # optional",
      "IGNORED LINE",
      "# COMMENTED=true"
    ].join("\n"));

    assert.deepEqual(values, {
      DATA_DIR: "./data",
      BANGUMI_USER_AGENT: "anime-quarter-schedule-local/0.1.0 (contact: local-dev)",
      BAHAMUT_TIMETABLE_URLS: ""
    });
  });

  it("loads .env.local before .env without overwriting existing process values", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "anime-env-loader-"));
    const env = { DATA_DIR: "from-process" } as unknown as NodeJS.ProcessEnv;

    try {
      await writeFile(join(cwd, ".env.local"), "DATA_DIR=from-local\nBAHAMUT_ENABLED=true\n", "utf8");
      await writeFile(join(cwd, ".env"), "BAHAMUT_ENABLED=false\nUPDATE_LOCK_TTL_SECONDS=900\n", "utf8");

      loadLocalEnv({ cwd, env });

      assert.equal(env.DATA_DIR, "from-process");
      assert.equal(env.BAHAMUT_ENABLED, "true");
      assert.equal(env.UPDATE_LOCK_TTL_SECONDS, "900");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
