import { Glob } from "bun";
import { parseDocumentFromFile, type DocumentError } from "../parser/document.ts";
import type { StorageWriter, StorageError } from "../storage/interface.ts";
import { type Result, ok, err } from "../lib/result.ts";

export type BuildReport = {
  total: number;
  succeeded: number;
  failed: Array<{ file: string; error: DocumentError }>;
};

export type EngineError = { type: "engine"; message: string };

export class Builder {
  constructor(private writer: StorageWriter) {}

  async build(sourceDir: string): Promise<Result<BuildReport, EngineError>> {
    try {
      const glob = new Glob("**/*.md");
      const files: string[] = [];

      for await (const file of glob.scan({ cwd: sourceDir, absolute: true })) {
        files.push(file);
      }

      const report: BuildReport = { total: files.length, succeeded: 0, failed: [] };

      for (const file of files) {
        const result = await parseDocumentFromFile(file);
        if (!result.ok) {
          report.failed.push({ file, error: result.error });
          continue;
        }

        const stored = this.writer.store(result.value);
        if (!stored.ok) {
          report.failed.push({
            file,
            error: { type: "read", message: (stored.error as StorageError).message },
          });
          continue;
        }

        report.succeeded++;
      }

      return ok(report);
    } catch (e) {
      return err({
        type: "engine",
        message: `Build failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}
