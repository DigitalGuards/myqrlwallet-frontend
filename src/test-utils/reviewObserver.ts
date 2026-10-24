/** Synthetic geometry and IO for state-machine tests only. Browser smoke proves visibility. */
export function mockReviewObservers(automatic = true) {
  const observers = new Set<MockIntersectionObserver>();
  const resizers = new Set<MockResizeObserver>();
  const rect = (height = 32, width = 100): DOMRect => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [1];
    targets = new Set<Element>();
    constructor(private callback: IntersectionObserverCallback) {
      observers.add(this);
    }
    observe(target: Element) {
      this.targets.add(target);
      if (automatic)
        queueMicrotask(() => {
          if (this.targets.has(target)) this.emit([target]);
        });
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    emit(targets = [...this.targets], ratio = 1, height = 16) {
      this.callback(
        targets.map((target) => ({
          target,
          time: performance.now(),
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
          boundingClientRect: rect(height),
          intersectionRect: rect(height * ratio),
          rootBounds: rect(500),
        })),
        this,
      );
    }
  }
  class MockResizeObserver implements ResizeObserver {
    targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) {
      resizers.add(this);
    }
    observe(target: Element) {
      this.targets.add(target);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      resizers.delete(this);
    }
  }
  const previousIO = globalThis.IntersectionObserver;
  const previousRO = globalThis.ResizeObserver;
  globalThis.IntersectionObserver = MockIntersectionObserver;
  globalThis.ResizeObserver = MockResizeObserver;
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(() => rect());
  const properties = ["clientWidth", "clientHeight", "scrollHeight"] as const;
  const originals = properties.map((key) =>
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
  );
  properties.forEach((key) =>
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get: () => (key === "clientWidth" ? 100 : 32),
    }),
  );
  return {
    resize(target: Element) {
      for (const observer of resizers) {
        if (observer.targets.has(target)) observer.callback([], observer);
      }
    },
    hold() {
      automatic = false;
    },
    settle() {
      if (automatic) for (const observer of observers) observer.emit();
    },
    get targets() {
      return [...observers].flatMap((observer) => [...observer.targets]);
    },
    emit(targets?: Element[], ratio = 1, height = 16) {
      for (const observer of observers)
        observer.emit(
          targets?.filter((target) => observer.targets.has(target)),
          ratio,
          height,
        );
    },
    emitQueued(targets: Element[]) {
      // Already queued entries can arrive after unobserve removes the target.
      for (const observer of observers) observer.emit(targets);
    },
    restore() {
      globalThis.IntersectionObserver = previousIO;
      globalThis.ResizeObserver = previousRO;
      properties.forEach((key, index) => {
        const original = originals[index];
        if (original)
          Object.defineProperty(HTMLElement.prototype, key, original);
        else Reflect.deleteProperty(HTMLElement.prototype, key);
      });
    },
  };
}
