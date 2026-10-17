// Keeps one friend game up to date in the browser.
//
// Realtime only says "this game changed" ({game_id, version, op} on the
// private channel game:<id>, sent by the games_broadcast trigger). An
// event is never taken as the new state: it only makes the browser read
// the row again (under RLS), and only rows newer than the one shown are
// used. So repeated, late or out-of-order events are harmless.
// When the channel is not joined (error, time-out, closed), the game is
// read every few seconds until it is joined again; on every (re)join it
// is read once, to catch up with anything missed.

import type { FriendGame } from "./friendGame";

export type FetchResult = { kind: "ok"; game: FriendGame } | { kind: "gone" } | { kind: "error" };
export type Connection = "connecting" | "live" | "reconnecting";

export interface SyncDeps {
  /** Reads the row again (RLS: only a player gets it). */
  fetchGame(): Promise<FetchResult>;
  /** Joins the channel; returns the function that leaves it. */
  subscribe(onEvent: (payload: unknown) => void, onStatus: (status: string) => void): () => void;
  onUpdate(game: FriendGame): void;
  /** The game can no longer be read (deleted, or no longer this player's). */
  onGone(): void;
  onConnection(state: Connection): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const POLL_MS = 5000;

export class GameSync {
  private current: FriendGame;
  private fetching: Promise<void> | null = null;
  private fetchAgain = false;
  private poll: unknown = null;
  private leave: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly deps: SyncDeps,
    initial: FriendGame,
  ) {
    this.current = initial;
  }

  get game(): FriendGame {
    return this.current;
  }

  start(): void {
    this.deps.onConnection("connecting");
    this.leave = this.deps.subscribe(
      (payload) => this.onEvent(payload),
      (status) => this.onStatus(status),
    );
  }

  /** Uses a game only if it is this game and newer than the one shown. */
  adopt(game: FriendGame): boolean {
    if (this.disposed || game.id !== this.current.id || game.version <= this.current.version) return false;
    this.current = game;
    this.deps.onUpdate(game);
    return true;
  }

  /** Reads the game again; calls made meanwhile share it (and cause one more read). */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.fetching) {
      this.fetchAgain = true;
      return this.fetching;
    }
    this.fetching = (async () => {
      do {
        this.fetchAgain = false;
        const result = await this.deps.fetchGame();
        if (this.disposed) return;
        if (result.kind === "ok") this.adopt(result.game);
        else if (result.kind === "gone") {
          this.deps.onGone();
          return;
        }
      } while (this.fetchAgain && !this.disposed);
    })().finally(() => {
      this.fetching = null;
    });
    return this.fetching;
  }

  /** Leaves the channel and stops every timer; later events are ignored. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPolling();
    this.leave?.();
    this.leave = null;
  }

  private onEvent(payload: unknown): void {
    if (this.disposed) return;
    const p = (typeof payload === "object" && payload !== null ? payload : {}) as { game_id?: unknown; version?: unknown; op?: unknown };
    if (typeof p.game_id === "string" && p.game_id.toLowerCase() !== this.current.id) return; // another game
    // a version already shown is a repeat; a DELETE is checked by reading
    if (p.op !== "DELETE" && typeof p.version === "number" && p.version <= this.current.version) return;
    void this.refresh();
  }

  private onStatus(status: string): void {
    if (this.disposed) return;
    if (status === "SUBSCRIBED") {
      this.stopPolling();
      this.deps.onConnection("live");
      void this.refresh(); // catch up with anything missed while away
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      this.deps.onConnection("reconnecting");
      this.startPolling();
    }
  }

  private startPolling(): void {
    if (this.poll !== null || this.disposed) return;
    const tick = () => {
      this.poll = this.deps.setTimer(() => {
        void this.refresh().then(() => {
          if (this.poll !== null && !this.disposed) tick();
        });
      }, POLL_MS);
    };
    tick();
  }

  private stopPolling(): void {
    if (this.poll === null) return;
    this.deps.clearTimer(this.poll);
    this.poll = null;
  }
}
