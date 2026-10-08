/// <reference lib="webworker" />
import { jsChessEngineMove } from "./jsChessEngineMove";
import type { EngineRequest, EngineResponse } from "./JsChessEngine";

// Runs js-chess-engine off the main thread so the board never freezes.
self.onmessage = (e: MessageEvent<EngineRequest>) => {
  const { id, fen, level } = e.data;
  let response: EngineResponse;
  try {
    response = { id, move: jsChessEngineMove(fen, level) };
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
