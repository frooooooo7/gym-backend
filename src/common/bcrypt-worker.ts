import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

type HashPayload = { type: "hash"; password: string; rounds: number };
type ComparePayload = { type: "compare"; password: string; hash: string };
type WorkerPayload = HashPayload | ComparePayload;

type WorkerResponse =
  | { id: number; ok: true; result: string | boolean }
  | { id: number; ok: false; error: string };

type Pending = {
  resolve: (value: string | boolean) => void;
  reject: (error: Error) => void;
};

interface PoolWorker {
  worker: Worker;
  pending: Map<number, Pending>;
}

const WORKER_SOURCE = `
"use strict";
const { parentPort } = require("node:worker_threads");
const bcrypt = require("bcryptjs");

parentPort.on("message", async (msg) => {
  try {
    const result =
      msg.type === "hash"
        ? await bcrypt.hash(msg.password, msg.rounds)
        : await bcrypt.compare(msg.password, msg.hash);
    parentPort.postMessage({ id: msg.id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
`;

/**
 * bcrypt is CPU-bound (hundreds of ms per call at cost 12 in pure JS). One
 * worker meant every login, registration and password check in the process
 * queued on a single core, so a burst of logins from many IPs stalled them
 * all. A small pool — one worker per core, keeping one core for the event
 * loop, 2…4 — runs them in parallel. Workers start lazily.
 */
const POOL_SIZE = Math.min(4, Math.max(2, availableParallelism() - 1));

const pool: (PoolWorker | null)[] = Array.from({ length: POOL_SIZE }, () => null);
let nextId = 1;

const startWorker = (slot: number): PoolWorker => {
  const entry: PoolWorker = {
    worker: new Worker(WORKER_SOURCE, { eval: true }),
    pending: new Map(),
  };
  entry.worker.unref();
  entry.worker.on("message", (msg: WorkerResponse) => {
    const task = entry.pending.get(msg.id);
    if (!task) return;
    entry.pending.delete(msg.id);
    if (msg.ok) task.resolve(msg.result);
    else task.reject(new Error(msg.error));
  });
  const fail = (error: Error) => {
    if (pool[slot] === entry) pool[slot] = null;
    for (const task of entry.pending.values()) task.reject(error);
    entry.pending.clear();
  };
  entry.worker.on("error", fail);
  entry.worker.on("exit", (code) => fail(new Error(`bcrypt worker exited (${code})`)));
  pool[slot] = entry;
  return entry;
};

/** The least busy worker (an idle or not-yet-started slot wins). */
const pickWorker = (): PoolWorker => {
  let best: PoolWorker | null = null;
  for (let slot = 0; slot < pool.length; slot++) {
    const entry = pool[slot];
    if (!entry) return startWorker(slot);
    if (entry.pending.size === 0) return entry;
    if (!best || entry.pending.size < best.pending.size) best = entry;
  }
  return best!;
};

const callWorker = <T extends string | boolean>(
  payload: WorkerPayload,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const entry = pickWorker();
    entry.pending.set(id, {
      resolve: resolve as (value: string | boolean) => void,
      reject,
    });
    entry.worker.postMessage({ id, ...payload });
  });

export const hashPassword = (
  password: string,
  rounds: number,
): Promise<string> => callWorker<string>({ type: "hash", password, rounds });

export const comparePassword = (
  password: string,
  hash: string,
): Promise<boolean> => callWorker<boolean>({ type: "compare", password, hash });
