import { conflictPath as createConflictPath } from "../utils/path";
import type { ConflictContext, ResolvedConflict } from "../types/sync";
import type { ConflictRule } from "../types/settings";

export type ConflictPrompt = (context: ConflictContext) => Promise<ConflictRule>;

export class ConflictResolver {
  constructor(
    private readonly defaultRule: ConflictRule,
    private readonly deviceId: string,
    private readonly prompt?: ConflictPrompt,
  ) {}

  async resolve(context: ConflictContext): Promise<ResolvedConflict> {
    const rule = this.defaultRule === "ask-user" && this.prompt ? await this.prompt(context) : this.defaultRule;

    if (rule === "keep-local") {
      return { type: "upload", path: context.path };
    }

    if (rule === "keep-remote") {
      return { type: "download", path: context.path };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return {
      type: "keep-both",
      path: context.path,
      conflictPath: createConflictPath(context.path, this.deviceId, timestamp),
    };
  }
}
