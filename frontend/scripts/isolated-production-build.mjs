/**
 * Copy the frontend tree without development .next output and build it.
 * The copy lives under /tmp so the running dev servers keep their own .next.
 * Dependency directories are symlinked, not duplicated.
 */
import { cpSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const source = "/workspace";
const dest = "/tmp/uog-frontend-build";

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
const built = spawnSync("pnpm", ["build"], { cwd: dest, stdio: "inherit" });
console.log(`isolated admin build present: ${lstatSync(join(dest, "apps/admin-web/.next"), { throwIfNoEntry: false })?.isDirectory() === true}`);
console.log(`isolated public build present: ${lstatSync(join(dest, "apps/public-web/.next"), { throwIfNoEntry: false })?.isDirectory() === true}`);
process.exit(built.status ?? 1);
