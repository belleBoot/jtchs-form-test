#!/usr/bin/env node
/**
 * Batch-download TTS audio using the same API as the kiosk:
 *   POST { "text": "..." } → binary audio (saved as .mp3).
 *
 * Usage:
 *   pnpm exec node scripts/fetch-jtchs-tts-audio.mjs
 *   WORKER_URL=https://your-worker.example.com/tts node scripts/fetch-jtchs-tts-audio.mjs
 *
 * Writes files to public/audio/jtchs/ (q1.mp3 … q17.mp3, submit.mp3).
 * Keep clip text in sync with public/survey.html → JTCHS_QUESTIONS[].tts and submitText.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "audio", "jtchs");
const WORKER_URL = process.env.WORKER_URL || "https://jtchs-form.thankyoudom.workers.dev/tts";
const DELAY_MS = Number(process.env.DELAY_MS || 400);

/** @type {{ file: string; text: string }[]} */
const CLIPS = [
  {
    file: "q1.mp3",
    text: "Question 1: I am,  60 - 64 years old, 65 - 69 years old, 70 - 74 years old, 75 - 79 years old, 80 years or older",
  },
  {
    file: "q2.mp3",
    text: "Question 2: I am, female, or, I am, male,",
  },
  {
    file: "q3.mp3",
    text: "Question 3: I have doctor appointments, once per year, twice per year, three times per year, four or more times per year",
  },
  {
    file: "q4.mp3",
    text: "Question 4: I require transportation to my appointments, yes, or no ",
  },
  {
    file: "q5.mp3",
    text: "Question 5: Fatigue: In the last 4 weeks, how much of the time did you feel tired? All or most of the time, Usually none of the time",
  },
  {
    file: "q6.mp3",
    text: "Question 6: Resistance: Do you have any difficulty walking up 10 steps alone without resting or aids? yes, or no ",
  },
  {
    file: "q7.mp3",
    text: "Question 7: Aerobic/Ambulation: Do you have any difficulty walking several hundred yards alone without aids? yes, or no ",
  },
  {
    file: "q8.mp3",
    text: "Question 8: Illnesses: Do you have 5 or more illnesses (out of 11 common conditions)? yes, or no ",
  },
  {
    file: "q9.mp3",
    text: "Question 9: Loss of Weight: Have you lost more than 5% of your total body weight in the past 6 months? yes, or no ",
  },
  {
    file: "q10.mp3",
    text: "Question 10: My appetite is, very poor, poor, average, good, very good",
  },
  {
    file: "q11.mp3",
    text: "Question 11: Food tastes, very poor, poor, average, good, very good",
  },
  {
    file: "q12.mp3",
    text: "Question 12: When I eat, I feel full after eating only a few mouthfuls, I feel full after eating about a third of the meal, I feel full after eating over half a meal, I feel full after eating most of the meal, I hardly ever feel full  ",
  },
  {
    file: "q13.mp3",
    text: "Question 13: Normally I eat, Less than onemeal a day, One meal a day, Two meals a day, Three meals a day, More than three meals a day",
  },
  {
    file: "q14.mp3",
    text: "Question 14: I enjoyed learning using Pepper. yes, or no",
  },
  {
    file: "q15.mp3",
    text: "Question 15: I needed help with using Pepper. yes, or no",
  },
  {
    file: "q16.mp3",
    text: "Question 16: I felt comfortable using Pepper to answer questions about my health. yes, or no",
  },
  {
    file: "q17.mp3",
    text: "Question 17: Using Pepper made me feel comfortable using technology for my healthcare, agree , neutral, disagree",
  },
  {
    file: "submit.mp3",
    text: "Thank you for completing the survey. Your responses have been recorded.",
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("Worker:", WORKER_URL);
  console.log("Output:", OUT_DIR);
  console.log("---");

  for (let i = 0; i < CLIPS.length; i++) {
    const { file, text } = CLIPS[i];
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`FAIL ${file}: HTTP ${res.status} ${errBody.slice(0, 200)}`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const path = join(OUT_DIR, file);
    writeFileSync(path, buf);
    console.log(`OK ${file} (${(buf.length / 1024).toFixed(1)} KB)`);
    if (i < CLIPS.length - 1) await sleep(DELAY_MS);
  }

  console.log("---");
  console.log("Done. Commit public/audio/jtchs/*.mp3 when satisfied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
