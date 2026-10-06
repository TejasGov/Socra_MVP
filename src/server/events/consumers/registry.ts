import "server-only";
import type { Tx } from "../../db";
import type { EventEnvelope } from "../envelope";
import type { EventName } from "../taxonomy";

/**
 * Outbox consumer registry. Domain modules register consumers from `src/server/events/consumers/index.ts`
 * (imported once by the worker). Example:
 *
 *   registerConsumer({
 *     name: "learning-evidence",
 *     events: ["submission_completed", "practice_answered"],
 *     handle: async (event, tx) => { await normalizeEvidence(event, tx); },
 *   });
 *
 * Delivery guarantees (see dispatcher.ts):
 *  - At-least-once delivery, exactly-once *effect* per (consumer, eventId) via the ProcessedEvent ledger.
 *  - `transactional: true` (default): the ProcessedEvent row and everything `handle` writes through `tx` commit
 *    atomically. Keep these handlers short (no network calls).
 *  - `transactional: false`: `handle` receives the root client (no tx) and the ledger row is written after it
 *    succeeds. Use for slow work (AI calls, embeddings); the handler itself must be idempotent (e.g. upserts keyed
 *    by eventId).
 */

export interface EventConsumer {
  /** Stable unique name; part of the idempotency key. Never rename a deployed consumer. */
  name: string;
  /** Event names to receive, or "*" for all accepted events. */
  events: readonly EventName[] | "*";
  transactional?: boolean;
  handle(event: EventEnvelope, tx: Tx): Promise<void>;
}

const consumers = new Map<string, EventConsumer>();

export function registerConsumer(consumer: EventConsumer): void {
  if (consumers.has(consumer.name)) {
    // Re-registration (e.g. dev HMR) replaces the previous definition.
    consumers.delete(consumer.name);
  }
  consumers.set(consumer.name, consumer);
}

export function unregisterConsumer(name: string): void {
  consumers.delete(name);
}

export function getConsumers(): EventConsumer[] {
  return [...consumers.values()];
}

export function consumersFor(eventName: string): EventConsumer[] {
  return getConsumers().filter(
    (c) => c.events === "*" || (c.events as readonly string[]).includes(eventName),
  );
}

/** Test helper. */
export function clearConsumers(): void {
  consumers.clear();
}
