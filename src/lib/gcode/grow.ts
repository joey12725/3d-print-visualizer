// Append-only typed arrays that double when full. Used by the parser so it never has to
// know the number of segments up front.

type TypedCtor<T> = { new (n: number): T };

class GrowBase<T extends Float32Array | Uint32Array | Uint8Array> {
  data: T;
  length = 0;
  constructor(
    private ctor: TypedCtor<T>,
    initial = 1 << 16,
  ) {
    this.data = new ctor(initial);
  }
  protected ensure(extra: number) {
    const need = this.length + extra;
    if (need <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < need) cap *= 2;
    const next = new this.ctor(cap);
    next.set(this.data.subarray(0, this.length) as never);
    this.data = next;
  }
  push(v: number) {
    if (this.length === this.data.length) this.ensure(1);
    this.data[this.length++] = v;
  }
  push3(a: number, b: number, c: number) {
    this.ensure(3);
    const d = this.data;
    const i = this.length;
    d[i] = a;
    d[i + 1] = b;
    d[i + 2] = c;
    this.length = i + 3;
  }
  push6(a: number, b: number, c: number, e: number, f: number, g: number) {
    this.ensure(6);
    const d = this.data;
    const i = this.length;
    d[i] = a;
    d[i + 1] = b;
    d[i + 2] = c;
    d[i + 3] = e;
    d[i + 4] = f;
    d[i + 5] = g;
    this.length = i + 6;
  }
  /** Returns a right-sized copy (so the oversized buffer can be garbage collected). */
  trim(): T {
    return this.data.slice(0, this.length) as T;
  }
}

export class GrowF32 extends GrowBase<Float32Array> {
  constructor(initial?: number) {
    super(Float32Array, initial);
  }
}
export class GrowU32 extends GrowBase<Uint32Array> {
  constructor(initial?: number) {
    super(Uint32Array, initial);
  }
}
export class GrowU8 extends GrowBase<Uint8Array> {
  constructor(initial?: number) {
    super(Uint8Array, initial);
  }
}
