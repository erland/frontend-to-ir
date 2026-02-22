import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { makeWorkdir, unzipSafe, gitClone, execOrThrow } from "./utils.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const CLI = process.env.FRONTEND_TO_IR_CLI || "/deps/frontend-to-ir/dist/cli.js";

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/v1/ir", upload.single("inputZip"), async (req, res) => {
  const mode = (req.body.mode || req.body.language || "").toLowerCase();
  if (!mode) return res.status(400).json({ error: "Missing field: mode (or language)" });

  const repoUrl = req.body.repoUrl;

  const wd = await makeWorkdir("ir");
  try {
    const projectDir = path.join(wd.root, "project");
    if (repoUrl) {
      await gitClone(repoUrl, projectDir);
    } else if (req.file) {
      const zipPath = path.join(wd.root, "input.zip");
      await fs.promises.writeFile(zipPath, req.file.buffer);
      await unzipSafe(zipPath, projectDir);
    } else {
      return res.status(400).json({ error: "Provide inputZip or repoUrl" });
    }

    const outDir = path.join(wd.root, "out");
    await fs.promises.mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, "model.ir.json");

    // frontend-to-ir CLI has no "extract" subcommand; extraction is the default action.
    // It expects --source and --out, and uses --framework auto|react|angular|none.
    const framework = (mode === "react" || mode === "angular") ? mode : "none";

    // Run: node <cli.js> --framework <framework> --source <dir> --out <file>
    await execOrThrow("node", [CLI, "--framework", framework, "--source", projectDir, "--out", outFile], {
      timeoutMs: 5 * 60_000,
    });

    const irJson = await fs.promises.readFile(outFile, "utf-8");
    res.status(200).type("application/json").send(irJson);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  } finally {
    await wd.cleanup();
  }
});

app.listen(7071, () => console.log("ir-service listening on :7071"));
