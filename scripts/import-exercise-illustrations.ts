/**
 * Converts the generated mannequin illustrations into the committed
 * public/exercise-images/<slug>.webp files (see system-exercise-images.ts)
 * and removes webp files no longer mapped to any exercise.
 *
 * Input files are named by the number at the end of the system exercise id,
 * zero-padded to two digits (01 = …001 bench press, 14 = …014 stretch,
 * 113 = …113), any of png/jpg/jpeg/webp, in 4:3 landscape.
 *
 * Usage: npm run import:exercise-illustrations [-- inputDir]
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
// Gemini returns e.g. 2400x1792 for "4:3" — allow that much drift.
const ASPECT_TOLERANCE = 0.02;
const EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

const inputNumber = (exerciseId: string): string =>
  String(Number.parseInt(exerciseId.split("-").at(-1)!, 10)).padStart(2, "0");

const main = async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const inputs = await fs.readdir(INPUT_DIR);
  const problems: string[] = [];

  for (const [exerciseId, slug] of Object.entries(SYSTEM_EXERCISE_IMAGES)) {
    const number = inputNumber(exerciseId);
    const matches = inputs.filter(
      (f) =>
        path.parse(f).name === number &&
        EXTENSIONS.includes(path.extname(f).toLowerCase()),
    );
    if (matches.length !== 1) {
      problems.push(
        matches.length === 0
          ? `${number} (${slug}): missing`
          : `${number} (${slug}): ambiguous, keep one of ${matches.join(", ")}`,
      );
      continue;
    }

    const input = path.join(INPUT_DIR, matches[0]);
    const { width, height } = await sharp(input).metadata();
    if (
      !width ||
      !height ||
      Math.abs(width / height - WIDTH / HEIGHT) > ASPECT_TOLERANCE
    ) {
      problems.push(`${matches[0]} (${slug}): ${width}x${height} is not 4:3`);
      continue;
    }

    const target = path.join(OUTPUT_DIR, `${slug}.webp`);
    await sharp(input)
      .resize(WIDTH, HEIGHT, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(target);
    const { size } = await fs.stat(target);
    console.log(`✓ ${matches[0]} → ${slug}.webp (${Math.round(size / 1024)} KB)`);
  }

  if (problems.length > 0) {
    console.error(`\nProblems in ${INPUT_DIR}:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }

  const expected = new Set(
    Object.values(SYSTEM_EXERCISE_IMAGES).map((slug) => `${slug}.webp`),
  );
  for (const file of await fs.readdir(OUTPUT_DIR)) {
    if (file.endsWith(".webp") && !expected.has(file)) {
      await fs.rm(path.join(OUTPUT_DIR, file));
      console.log(`✗ removed unused ${file}`);
    }
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
