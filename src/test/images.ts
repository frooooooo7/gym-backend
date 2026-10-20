import sharp from "sharp";

/** A real, decodable image (tiny) — uploads are re-encoded with sharp. */
export const tinyImage = (
  format: "png" | "jpeg" | "webp" = "png",
  size = 8,
): Promise<Buffer> =>
  sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 37, g: 99, b: 235 },
    },
  })
    .toFormat(format)
    .toBuffer();
