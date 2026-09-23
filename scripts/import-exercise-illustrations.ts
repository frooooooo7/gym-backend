/**
 * Converts the generated mannequin illustrations into the committed
 * public/exercise-images/<slug>.webp files (see system-exercise-images.ts).
 *
 * Input files are named by the last two digits of the system exercise id
 * (01 = …001 bench press … 14 = …014 stretch), any of png/jpg/jpeg/webp.
 *
 * Usage: npx tsx scripts/import-exercise-illustrations.ts [inputDir]
 *   inputDir  defaults to ../exercise-illustrations/generated
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SYSTEM_EXERCISE_IMAGES } from "../src/modules/exercises/system-exercise-images.js";

const INPUT_DIR = path.resolve(
  process.argv[2] ?? path.join("..", "exercise-illustrations", "generated"),
);
const OUTPUT_DIR = path.join(process.cwd(), "public", "exercise-images");
// Cards render up to ~400 logical px wide; 1024 px covers 2.5x screens.
const WIDTH = 1024;
const HEIGHT = 768;
const EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

const main = async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const inputs = await fs.readdir(INPUT_DIR);
  const missing: string[] = [];

  for (const [exerciseId, slug] of Object.entries(SYSTEM_EXERCISE_IMAGES)) {
    const number = exerciseId.slice(-2);
    const input = inputs.find(
      (f) =>
        path.parse(f).name === number &&
        EXTENSIONS.includes(path.extname(f).toLowerCase()),
    );
    if (!input) {
      missing.push(`${number} (${slug})`);
      continue;
    }

    const target = path.join(OUTPUT_DIR, `${slug}.webp`);
    await sharp(path.join(INPUT_DIR, input))
      // 4:3 like the prompts ask for; `cover` only trims a stray off-ratio edge.
      .resize(WIDTH, HEIGHT, { fit: "cover" })
      .webp({ quality: 80 })
      .toFile(target);
    const { size } = await fs.stat(target);
    console.log(`✓ ${input} → ${slug}.webp (${Math.round(size / 1024)} KB)`);
  }

  if (missing.length > 0) {
    console.error(`\nMissing in ${INPUT_DIR}:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
