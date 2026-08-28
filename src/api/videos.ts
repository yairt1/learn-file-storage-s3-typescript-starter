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

  await uploadVideoToS3(cfg, key, tempFilePath, mediaType);

  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
  video.videoURL = videoURL;
  updateVideo(cfg.db, video);

  await Promise.all([rm(tempFilePath, { force: true })]);

  return respondWithJSON(200, video);
}
