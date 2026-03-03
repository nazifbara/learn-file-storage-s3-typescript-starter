import type { BunRequest } from "bun";
import { randomBytes } from "node:crypto";

import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from "../auth";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getVideo, updateVideo } from "../db/videos";
import { type ApiConfig } from "../config";
import path from "node:path";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;

  const { videoId } = req.params as { videoId?: string };

  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videoMeta = getVideo(cfg.db, videoId);

  if (!videoMeta) {
    throw new NotFoundError("Video not found");
  }

  if (videoMeta.userID !== userID) {
    throw new UserForbiddenError("No allowed");
  }

  const formData = await req.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File shoudn't exceed 1GB");
  }

  if (!["video/mp4"].includes(file.type)) {
    throw new BadRequestError("Mime type not supported");
  }

  console.log("uploading video", videoId, "by user", userID);

  const extension = file.type.split("/")[1];
  const fileKey = `${randomBytes(32).toString("base64url")}.${extension}`;
  await cfg.s3Client.write(fileKey, await file.arrayBuffer(), {
    type: file.type,
  });

  videoMeta.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileKey}`;

  updateVideo(cfg.db, videoMeta);

  return respondWithJSON(200, null);
}
