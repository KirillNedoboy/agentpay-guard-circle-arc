import { readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvaluationObservation } from "./evaluation-observation";

const locks = new Map<string, Promise<unknown>>();

async function withObservationLock<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve();
  const current = previous.then(task, task);
  locks.set(path, current);

  try {
    return await current;
  } finally {
    if (locks.get(path) === current) {
      locks.delete(path);
    }
  }
}

export async function appendEvaluationObservation(
  observationPath: string,
  observation: EvaluationObservation
): Promise<void> {
  return withObservationLock(observationPath, async () => {
    await mkdir(dirname(observationPath), { recursive: true });
    await appendFile(observationPath, `${JSON.stringify(observation)}\n`, "utf8");
  });
}

export function readEvaluationObservations(observationPath: string): EvaluationObservation[] {
  try {
    const content = readFileSync(observationPath, "utf8");
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as EvaluationObservation);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
