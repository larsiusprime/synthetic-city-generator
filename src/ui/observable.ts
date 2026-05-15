export type Subscriber<T> = (value: T) => void;

export class Observable<T> {
  private value: T;
  private readonly subscribers = new Set<Subscriber<T>>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    if (Object.is(this.value, next)) return;
    this.value = next;
    for (const s of this.subscribers) s(next);
  }

  update(updater: (prev: T) => T): void {
    this.set(updater(this.value));
  }

  subscribe(fn: Subscriber<T>, fireInitial: boolean = true): () => void {
    this.subscribers.add(fn);
    if (fireInitial) fn(this.value);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}
