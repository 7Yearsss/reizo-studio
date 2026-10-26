import { MUTATING_TOOL_NAMES } from './toolLoopGuard';

type Executable = { execute?: (input: never, options: never) => unknown };

/**
 * The AI SDK runs every tool call of a step concurrently. Two edits to the
 * same file in one step would race, so state-changing tools queue behind one
 * another (in the order the model issued them) while read-only tools stay
 * parallel. A failed or rejected call never blocks the queue.
 */
export function serializeMutatingTools<T extends Record<string, unknown>>(
  tools: T,
  isMutating: (name: string) => boolean = (name) => MUTATING_TOOL_NAMES.has(name),
): T {
  let tail: Promise<unknown> = Promise.resolve();
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(tools)) {
    const original = (value as Executable)?.execute;
    if (typeof original !== 'function' || !isMutating(name)) { wrapped[name] = value; continue; }
    wrapped[name] = {
      ...(value as object),
      execute: (input: never, options: never) => {
        const run = tail.then(() => original(input, options), () => original(input, options));
        tail = run.catch((): void => undefined);
        return run;
      },
    };
  }
  return wrapped as T;
}
