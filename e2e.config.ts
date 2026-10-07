import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Model credentials come from the OS user environment variables
 * LLM_BASE_URL / LLM_KEY / LLM_MODEL_ID.
 *
 * They are persisted at the Windows user level (HKCU\Environment), so every new
 * process inherits them. Nothing is exported per shell and no secret is written
 * into this file or into any .env file that could be committed.
 */
const { LLM_BASE_URL, LLM_KEY, LLM_MODEL_ID } = process.env;

if (!LLM_BASE_URL || !LLM_KEY || !LLM_MODEL_ID) {
  throw new Error(
    "Missing LLM_* user environment variables. " +
      "Expected LLM_BASE_URL, LLM_KEY and LLM_MODEL_ID to be set for the current user.",
  );
}

const llm = createOpenAICompatible({
  name: "llm-gateway",
  baseURL: LLM_BASE_URL,
  apiKey: LLM_KEY,
});

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5173";

export default {
  agents: {
    default: {
      model: llm.chatModel(LLM_MODEL_ID),
      system: [
        "You are a QA agent testing an anonymous invite-code sharing pool.",
        "The product: anyone can drop a spare invite code into the pool, and anyone can claim one.",
        "There are no accounts and no login. The homepage shows only the total pool size and",
        "the newest 20 claimable entries; the dashboard shows additions versus consumption over time.",
        "Per browser the quota is 3 claims, 3 contributions and 3 dice rolls per app per day.",
        "Rules to respect while testing:",
        "- Never invent data. Assert only on what is actually on screen.",
        "- A claimed code is consumed: it leaves the pool, so the pool total must go down by one.",
        "- When the quota is exhausted the UI must say so and disable the action, not fail silently.",
        "- Report a failed assertion as a bug with the exact element text you observed.",
      ].join(" "),
    },
  },
  targets: [
    {
      engine: web(),
      app: {
        url: APP_URL,
        // The runner starts Vite, waits for APP_URL, and stops it when the run ends.
        //
        // Do NOT use `executable: 'npm'` / `'npm.cmd'` here: the runner spawns
        // without a shell, and Node refuses to spawn .cmd/.bat directly on
        // Windows (spawn EINVAL). Running Vite's JS entry with the same node
        // that runs e2e sidesteps that and stays portable.
        command: {
          executable: process.execPath,
          args: [
            "node_modules/vite/bin/vite.js",
            "--host",
            "127.0.0.1",
            "--port",
            "5173",
          ],
          reuseExisting: true,
          log: ".e2e/logs/app.log",
        },
      },
    },
  ],
} satisfies E2EConfig;
