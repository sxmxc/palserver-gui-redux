// Bundles the agent (including @palserver/shared and all npm dependencies) into one file as the basis
// for the standalone executable (Node SEA). cpu-features is ssh2's optional native acceleration module (.node),
// which cannot be bundled and is not required, so it is externalized; ssh2 automatically falls back to pure JavaScript without it. dockerode uses a local
// socket and does not use ssh2 connections in practice, but docker-modem requires it at load time,
// so ssh2 itself (the pure JavaScript portion) must be bundled to prevent a startup crash.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The version baked into the executable. Self-update uses it to determine whether it is current, so it must equal the
 * release tag for this build; otherwise it will still appear outdated after updating.
 *  - CI releases are triggered by a tag, so GITHUB_REF_NAME is that tag (for example, v2.0.0-alpha.3).
 *  - Local/manual builds fall back to the nearest git tag, then the agent package.json version.
 */
function resolveAgentVersion() {
  const ref = process.env.GITHUB_REF_NAME;
  if (ref && /^v\d/.test(ref)) return ref.replace(/^v/, "");
  try {
    const desc = execSync("git describe --tags --abbrev=0", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (/^v?\d/.test(desc)) return desc.replace(/^v/, "");
  } catch {
    /* No tag, or not a git repository: fall through. */
  }
  const pkg = createRequire(import.meta.url)(path.join(root, "packages/agent/package.json"));
  return pkg.version;
}

const version = resolveAgentVersion();

await build({
  entryPoints: [path.join(root, "packages/agent/dist/index.js")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(root, "packages/agent/bundle/agent.cjs"),
  external: ["cpu-features"],
  // Bake the version into the bundle: env.ts reads process.env.PALSERVER_AGENT_VERSION, which is replaced here with a literal.
  define: { "process.env.PALSERVER_AGENT_VERSION": JSON.stringify(version) },
  logLevel: "info",
});

console.log(`bundled → packages/agent/bundle/agent.cjs (version ${version})`);
