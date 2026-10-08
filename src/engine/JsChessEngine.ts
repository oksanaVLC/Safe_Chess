import type { ChessEngine, Level } from "./ChessEngine";

export interface EngineRequest {
  id: number;
  fen: string;
  level: Exclude<Level, 1>;
}

export type EngineResponse = { id: number; move: string } | { id: number; error: string };

/** ChessEngine backed by js-chess-engine (MIT) running in a Web Worker. */
export class JsChessEngine implements ChessEngine {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (m: string) => void; reject: (e: Error) => void }>();

  getBestMove(fen: string, level: Level): Promise<string> {
    if (level === 1) return Promise.reject(new Error("Level 1 does not use the engine"));
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, fen, level } satisfies EngineRequest);
    });
  }

  /** Stops any running search (e.g. on Undo or New) and frees the worker. */
  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error("Engine stopped"));
    this.pending.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if ("move" in e.data) p.resolve(e.data.move);
      else p.reject(new Error(e.data.error));
    };
    this.worker = worker;
    return worker;
  }
}
