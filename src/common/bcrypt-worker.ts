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

const pending = new Map<number, Pending>();
let nextId = 1;
let worker: Worker | null = null;

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

const getWorker = (): Worker => {
  if (worker) return worker;
  const created = new Worker(WORKER_SOURCE, { eval: true });
  created.unref();
  created.on("message", (msg: WorkerResponse) => {
    const task = pending.get(msg.id);
    if (!task) return;
    pending.delete(msg.id);
    if (msg.ok) task.resolve(msg.result);
    else task.reject(new Error(msg.error));
  });
  created.on("error", (error) => {
    worker = null;
    for (const task of pending.values()) {
      task.reject(error);
    }
    pending.clear();
  });
  created.on("exit", () => {
    if (worker === created) worker = null;
  });
  worker = created;
  return created;
};

const callWorker = <T extends string | boolean>(
  payload: WorkerPayload,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {
      resolve: resolve as (value: string | boolean) => void,
      reject,
    });
    getWorker().postMessage({ id, ...payload });
  });

export const hashPassword = (
  password: string,
  rounds: number,
): Promise<string> => callWorker<string>({ type: "hash", password, rounds });

export const comparePassword = (
  password: string,
  hash: string,
): Promise<boolean> => callWorker<boolean>({ type: "compare", password, hash });
