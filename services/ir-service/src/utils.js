import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import unzipper from "unzipper";

/**
 * @typedef {{ root: string, cleanup: () => Promise<void> }} Workdir
 */

/**
 * @param {string} prefix
 * @returns {Promise<Workdir>}
 */
export async function makeWorkdir(prefix) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  return {
    root,
    cleanup: async () => {
      // best-effort cleanup
      await fs.promises.rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Safely extracts a zip into destDir with zip-slip protection.
 * @param {string} zipPath
 * @param {string} destDir
 */
export async function unzipSafe(zipPath, destDir) {
  await fs.promises.mkdir(destDir, { recursive: true });

  const directory = await unzipper.Open.file(zipPath);

  for (const entry of directory.files) {
    const fileName = entry.path;

    // prevent zip-slip
    const resolved = path.resolve(destDir, fileName);
    if (!resolved.startsWith(path.resolve(destDir) + path.sep)) {
      throw new Error(`Unsafe zip entry path: ${fileName}`);
    }

    if (entry.type === "Directory") {
      await fs.promises.mkdir(resolved, { recursive: true });
      continue;
    }

    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await new Promise((resolve, reject) => {
      entry
        .stream()
        .pipe(fs.createWriteStream(resolved))
        .on("finish", () => resolve())
        .on("error", reject);
    });
  }
}

/**
 * @param {string} repoUrl
 * @param {string} destDir
 */
export async function gitClone(repoUrl, destDir) {
  await fs.promises.mkdir(path.dirname(destDir), { recursive: true });
  await execOrThrow("git", ["clone", "--depth", "1", repoUrl, destDir], { timeoutMs: 5 * 60_000 });
}

/**
 * Executes a command and rejects if exit code != 0.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?: string, timeoutMs?: number, env?: Record<string, string | undefined>}=} opts
 * @returns {Promise<{stdout: string, stderr
 */
export async function execOrThrow(cmd, args, opts) {
  const cwd = opts?.cwd;
  const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
  const env = { ...process.env, ...(opts?.env ?? {}) };

  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

    const chunksOut= [];
    const chunksErr= [];
    child.stdout.on("data", (d) => chunksOut.push(Buffer.from(d)));
    child.stderr.on("data", (d) => chunksErr.push(Buffer.from(d)));

    const to = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out: ${cmd} ${args.join(" ")}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(to);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(to);
      const stdout = Buffer.concat(chunksOut).toString("utf-8");
      const stderr = Buffer.concat(chunksErr).toString("utf-8");
      if (code !== 0) {
        reject(new Error(`Command failed (${code}): ${cmd} ${args.join(" ")}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
