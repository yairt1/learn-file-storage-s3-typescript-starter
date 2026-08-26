import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import type { ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { getDataURL } from "./assets";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
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
  const thumbnail = formData.get("thumbnail");

  if (!(thumbnail instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;

  if (thumbnail.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(
      "Thumbnail file exceeds the maximum allowed size of 10MB",
    );
  }

  const mediaType = thumbnail.type;
  const fileData = await thumbnail.arrayBuffer();

  const base64Encoded = Buffer.from(fileData).toString("base64");
  const base64DataURL = getDataURL(mediaType, base64Encoded);
  video.thumbnailURL = base64DataURL;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
