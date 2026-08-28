import { rm } from "fs/promises";
import path from "path";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { uploadVideoToS3 } from "../s3";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";

import type { BunRequest } from "bun";
import { type ApiConfig } from "../config";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAC_UPLOAD_SIZE = 1 << 30;
  const { videoId } = req.params as { videoId?: string };

  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);

  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to update this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  if (file.size > MAC_UPLOAD_SIZE) {
    throw new BadRequestError(
      "Video file exceeds the maximum allowed size of 1GB",
    );
  }

  const mediaType = file.type;

  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Invalid file type. Only MP4 allowed");
  }

  const key = `${videoId}.mp4`;
  const tempFilePath = path.join("/tmp", key);
  await Bun.write(tempFilePath, file);

  const aspectRatio = await getVideoAspectRatio(tempFilePath);
  const fullKey = `${aspectRatio}/${key}`;

  await uploadVideoToS3(cfg, fullKey, tempFilePath, mediaType);

  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fullKey}`;
  video.videoURL = videoURL;
  updateVideo(cfg.db, video);

  await Promise.all([rm(tempFilePath, { force: true })]);

  return respondWithJSON(200, video);
}

export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.log(stderrText);
    throw new Error("Couldn't get video aspect ratio");
  }

  const output = JSON.parse(stdoutText);

  if (!output.streams || output.streams.length === 0) {
    throw new Error("No video streams found");
  }

  const { width, height } = output.streams[0];

  return width === Math.floor(16 * (height / 9))
    ? "landscape"
    : height === Math.floor(16 * (width / 9))
      ? "portrait"
      : "other";
}
