// Compare two --dump outputs: the composite in IRE and the decoded frame in
// 8-bit steps. Reports the tail of the error distribution as well as the peak,
// because a thinned kernel fails as banding, which a peak alone waves through.
//
//   deno run -A scripts/gpuprof/cmp.ts out/a out/b

const [a, b] = Deno.args
if (a === undefined || b === undefined)
  throw new Error('usage: cmp.ts <dumpA> <dumpB>')

function stats(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  tail: number,
): string {
  let max = 0
  let sum = 0
  let over = 0
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - y[i])
    if (d > max) max = d
    sum += d
    if (d > tail) over += 1
  }
  return `max ${max.toFixed(4)}  mean ${(sum / x.length).toFixed(5)}  >${tail}: ${((100 * over) / x.length).toFixed(4)}%`
}

const compA = new Float32Array((await Deno.readFile(`${a}.comp.f32`)).buffer)
const compB = new Float32Array((await Deno.readFile(`${b}.comp.f32`)).buffer)
const outA = await Deno.readFile(`${a}.out.rgba`)
const outB = await Deno.readFile(`${b}.out.rgba`)
console.log(`composite (IRE)   ${stats(compA, compB, 0.01)}`)
console.log(`decoded (8-bit)   ${stats(outA, outB, 1)}`)
const faceA = await Deno.readFile(`${a}.face.rgba`)
const faceB = await Deno.readFile(`${b}.face.rgba`)
console.log(`crt face (8-bit)  ${stats(faceA, faceB, 1)}`)
