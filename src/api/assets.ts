import { existsSync, mkdirSync } from "fs";

import type { ApiConfig } from "../config";
import path from "path";

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

export function mediaTypeToExt(mediaType: string) {
  const parts = mediaType.split("/");

  if (parts.length !== 2) {
    return ".bin";
  }

  return "." + parts[1];
}

export function getAssetsDiskPath(cfg: ApiConfig, assetsPath: string) {
  return path.join(cfg.assetsRoot, assetsPath);
}

export function getAssetsURL(cfg: ApiConfig, assetsPath: string) {
  return `http://localhost:${cfg.port}/assets/${assetsPath}`;
}
