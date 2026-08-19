// The one steady-state GPU→CPU readback in the app, and the only reason it can
// exist without costing the render loop anything is that it never waits.
//
// `buzz_tap.wgsl` leaves 525 measurement pairs on the GPU each frame and the
// sound detector needs them on the CPU. `mapAsync` resolves a frame or two
// after submit, so a buffer that has been copied into cannot be mapped, read
// and reused within one frame — hence a pool. When every staging buffer is
// still in flight the frame is *skipped*, which is the whole trick: the audio
// side is a ring with a rate servo and glides over a missing frame, whereas a
// stall here would show up in the picture.
//
// A frame or two of latency is deliberate too. Buzz is a rasp; nobody can hear
// 30 ms of sync error on one, and paying for tighter would mean blocking.

const POOL = 3

export class BuzzRead {
  private readonly staging: GPUBuffer[]
  private free: GPUBuffer[]
  private queued: GPUBuffer[] = []
  private closed = false

  constructor(
    device: GPUDevice,
    private readonly bytes: number,
  ) {
    this.staging = Array.from({ length: POOL }, () =>
      device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
    )
    this.free = [...this.staging]
  }

  // Encode this frame's copy, if a staging buffer is going spare.
  copy(enc: GPUCommandEncoder, src: GPUBuffer): void {
    const buf = this.free.pop()
    if (buf !== undefined) {
      enc.copyBufferToBuffer(src, 0, buf, 0, this.bytes)
      this.queued.push(buf)
    }
  }

  // Call after the queue submit that contains the copy. `sink` gets a view over
  // the mapped range and must consume it synchronously — `unmap` below detaches
  // it, and holding on to it past that reads a detached buffer.
  flush(sink: (samples: Float32Array) => void): void {
    for (const buf of this.queued) {
      void buf.mapAsync(GPUMapMode.READ).then(
        () => {
          if (!this.closed) {
            sink(new Float32Array(buf.getMappedRange()))
            buf.unmap()
            this.free.push(buf)
          }
        },
        // A destroyed buffer or a lost device rejects the map. Both mean the
        // engine is going away, so there is nothing to report and nothing to
        // return to the pool.
        () => {},
      )
    }
    this.queued.length = 0
  }

  destroy(): void {
    this.closed = true
    for (const b of this.staging) b.destroy()
  }
}
