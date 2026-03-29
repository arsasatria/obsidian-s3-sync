import { sha256 } from "../utils/hash";
import type { LocalFileState } from "../types/manifest";
import type { VaultPort } from "./interfaces";
import { ExcludeFilter } from "../vault/exclude";
import { isMissingFileError } from "../utils/errors";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBinaryWithRetry(vault: VaultPort, path: string, attempts = 3): Promise<ArrayBuffer | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await vault.readBinary(path);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      if (attempt === attempts - 1) {
        return null;
      }
      await sleep(150 * (attempt + 1));
    }
  }
  return null;
}

export async function buildLocalState(vault: VaultPort, filter: ExcludeFilter): Promise<Map<string, LocalFileState>> {
  const state = new Map<string, LocalFileState>();
  const files = await vault.listFiles();

  for (const file of files) {
    if (filter.isExcluded(file.path)) {
      continue;
    }

    const body = await readBinaryWithRetry(vault, file.path);
    if (!body) {
      continue;
    }
    state.set(file.path, {
      mtime: file.mtime,
      size: file.size,
      sha256: await sha256(body),
    });
  }

  return state;
}
