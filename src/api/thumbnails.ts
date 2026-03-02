import { type BunRequest } from "bun";
import path from "node:path";
import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File shoudn't exceed 10MB");
  }

  const videoMeta = getVideo(cfg.db, videoId);

  if (!videoMeta) {
    throw new NotFoundError("Video not found");
  }

  if (videoMeta.userID !== userID) {
    throw new UserForbiddenError("No allowed");
  }

  const extension = file.type.split("/")[1];
  const buffer = await file.arrayBuffer();
  const thumbnailPath = path.join(cfg.assetsRoot, `./${videoId}.${extension}`);
  Bun.write(thumbnailPath, buffer);

  videoMeta.thumbnailURL = `http://localhost:${cfg.port}/assets/${videoId}.${extension}`;

  updateVideo(cfg.db, videoMeta);

  return respondWithJSON(200, videoMeta);
}
