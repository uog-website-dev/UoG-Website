/**
 * Copy the frontend tree without development .next output and build admin-web.
 * The copy lives under /tmp so the running dev servers keep their own .next.
 * Dependency directories are symlinked, not duplicated.
 */
import { cpSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const source = "/workspace";
const dest = "/tmp/uog-frontend-build";
const startedAt = performance.now();

function copySource() {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const pending = [source];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".next" || entry.name === "node_modules") continue;
      const from = join(current, entry.name);
      const to = join(dest, relative(source, from));
      if (entry.isDirectory()) {
        mkdirSync(to, { recursive: true });
        pending.push(from);
        continue;
      }
      if (entry.isSymbolicLink()) {
        symlinkSync(readlinkSync(from), to);
        continue;
      }
      cpSync(from, to);
    }
  }
  const linkModules = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const from = join(directory, entry.name);
      if (entry.name === ".next") continue;
      if (entry.name === "node_modules" && entry.isDirectory()) {
        const to = join(dest, relative(source, from));
        mkdirSync(join(to, ".."), { recursive: true });
        if (!lstatSync(to, { throwIfNoEntry: false })) {
          symlinkSync(from, to, "dir");
        }
        continue;
      }
      if (entry.isDirectory() && entry.name !== "node_modules") linkModules(from);
    }
  };
  linkModules(source);
}

copySource();
const built = spawnSync("pnpm", ["--filter", "@uog/admin-web...", "build"], { cwd: dest, stdio: "inherit" });
const adminBuildPresent = lstatSync(join(dest, "apps/admin-web/.next"), { throwIfNoEntry: false })?.isDirectory() === true;
const exitCode = built.status ?? 1;
if (exitCode === 0 && !adminBuildPresent) throw new Error("Admin production build output is missing");
console.log(`isolated admin build present: ${adminBuildPresent}`);
console.log(JSON.stringify({
  event: "uog.frontend.production-build",
  duration_ms: Number((performance.now() - startedAt).toFixed(1)),
  exit_code: exitCode,
  isolated_admin_build: adminBuildPresent,
}));
process.exit(exitCode);
