import type { BunRequest } from "bun";
import { randomBytes } from "node:crypto";

import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from "../auth";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getVideo, updateVideo } from "../db/videos";
import { type ApiConfig } from "../config";
import path from "node:path";

async function getVideoAspectRatio(filePath: string) {
  const process = Bun.spawn(
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
    { stdout: "pipe" },
  );

  if ((await process.exited) !== 0) {
    throw new Error(await new Response(process.stderr).text());
  }

  const stdoutText = await new Response(process.stdout).text();

  const { width, height } = JSON.parse(stdoutText).streams[0] as {
    width: number;
    height: number;
  };

  const aspectRatio = width / height;

  if (aspectRatio > 1.75 && aspectRatio < 1.79) {
    return "landscape";
  } else if (aspectRatio > 0.54 && aspectRatio < 0.58) {
    return "portrait";
  } else {
    return "other";
  }
}

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
  const fileName = `${randomBytes(32).toString("base64url")}.${extension}`;
  const buffer = await file.arrayBuffer();
  const tempFilePath = path.join(".", "./tmp/" + fileName);
  await Bun.write(tempFilePath, buffer);

  const aspectRation = await getVideoAspectRatio(tempFilePath);
  const fileKey = `${aspectRation}/${fileName}`;

  const tempFile = Bun.file(tempFilePath);

  await cfg.s3Client.write(fileKey, tempFile, {
    type: file.type,
  });
  await tempFile.delete();
  videoMeta.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileKey}`;

  updateVideo(cfg.db, videoMeta);

  return respondWithJSON(200, null);
}
