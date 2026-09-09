#!/usr/bin/env node
/**
 * Deploys narwhal-commands.js to DSH runtime node_modules so it can be
 * referenced from cordis.patch.yml as a bare module specifier.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const runtimeRoot =
  process.env.DSH_RUNTIME_ROOT ||
  resolve(__dirname, "..", "runtime", "dsh");

const pluginDir = join(runtimeRoot, "node_modules", "@narwhal", "narwhal-commands");
mkdirSync(pluginDir, { recursive: true });

writeFileSync(
  join(pluginDir, "package.json"),
  JSON.stringify({ name: "@narwhal/narwhal-commands", version: "1.0.0", type: "module", main: "index.js" }, null, 2)
);

// Use String.raw so ${} inside the plugin isn't interpolated here
const pluginCode = String.raw`
import { Service } from "@deepseek-ai/cordis";

/**
 * narwhal-commands: expose /plan, /feedback, /compact as HTTP endpoints
 * that Narwhal's host-bridge can invoke.
 *
 * These three commands are normally wired through DSH's cordis \`commands\`
 * service (WebSocket typert mux) — there is no apiProxy UNARY_ROUTES entry.
 * This plugin bridges the gap by registering webServer HTTP routes that
 * call the underlying cordis services directly.
 */
class NarwhalCommands extends Service {
  static inject = ["webServer", "sessions", "agents", "compaction"];

  constructor(ctx) {
    super(ctx, "narwhalCommands");
  }

  async [Service.init]() {
    const ctx = this.ctx;

    async function readBody(req) {
      if (!req.headers["content-type"]?.includes("application/json")) return {};
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf-8");
      if (!text) return {};
      try { return JSON.parse(text); } catch { throw new Error("invalid JSON body"); }
    }

    function sendJson(res, status, data) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    }

    ctx.webServer.register({
      kind: "prefix",
      path: "/api/narwhal",
      handler: async (req, res) => {
        const url = new URL(req.url, "http://x");
        const p = url.pathname;
        try {
          if (p === "/api/narwhal/plan" && req.method === "POST") {
            const { sessionId, active } = await readBody(req);
            if (!sessionId) return sendJson(res, 400, { ok: false, error: "sessionId required" });
            const session = ctx.sessions.get(sessionId);
            if (!session) return sendJson(res, 404, { ok: false, error: "session not found" });
            session.append("plan/mode", { active: !!active });
            return sendJson(res, 200, { ok: true, sessionId, active: !!active });
          }

          if (p === "/api/narwhal/feedback" && req.method === "POST") {
            const { sessionId, text } = await readBody(req);
            if (!sessionId) return sendJson(res, 400, { ok: false, error: "sessionId required" });
            if (!text?.trim()) return sendJson(res, 400, { ok: false, error: "text required" });
            const session = ctx.sessions.get(sessionId);
            if (!session) return sendJson(res, 404, { ok: false, error: "session not found" });
            session.append("feedback/record", { text: text.trim() });
            return sendJson(res, 200, { ok: true, sessionId });
          }

          if (p === "/api/narwhal/compact" && req.method === "POST") {
            const { sessionId } = await readBody(req);
            if (!sessionId) return sendJson(res, 400, { ok: false, error: "sessionId required" });
            const agent = ctx.agents.get(sessionId);
            if (!agent) return sendJson(res, 404, { ok: false, error: "no live agent for session" });
            const result = await ctx.compaction.compactNow(agent, new AbortController().signal, "narwhal-web");
            if (result === null) {
              return sendJson(res, 200, { ok: true, compacted: false, reason: "no compactable history" });
            }
            return sendJson(res, 200, {
              ok: true, compacted: true,
              shadowedSeqs: result.shadowedSeqs?.length ?? 0,
              shadowedTokens: result.shadowedTokenCount ?? 0,
              summarySeq: result.summarySeq,
            });
          }
          return sendJson(res, 404, { ok: false, error: "unknown endpoint" });
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
        }
      },
    });

    ctx.logger?.info?.("narwhal-commands plugin loaded: /api/narwhal/{plan,feedback,compact}");
  }
}

export default NarwhalCommands;
`;

writeFileSync(join(pluginDir, "index.js"), pluginCode);

// Also stage a copy into ~/.narwhal/narwhal-plugins/ for easy inspection
const dshHome = join(
  process.env.HOME || resolve("~"),
  ".narwhal"
);
const homeDir = join(dshHome, "narwhal-plugins");
mkdirSync(homeDir, { recursive: true });
writeFileSync(join(homeDir, "narwhal-commands.js"), pluginCode);

console.log("narwhal-commands plugin deployed:");
console.log("  →", join(pluginDir, "index.js"));
console.log("  →", join(homeDir, "narwhal-commands.js"));
