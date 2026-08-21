// Binding reflection over WGSL source: the `@group(g) @binding(b)` resource
// declarations a shader expects, in binding order. The engine wires bind
// groups positionally, so this is what lets anything else — the headless
// profiler, a test — bind by the names the shader itself declares and fail
// loudly on a mismatch instead of reading the wrong buffer.

export type BindingSpace =
  | 'uniform'
  | 'storage'
  | 'storage_rw'
  | 'texture'
  | 'storage_texture'
  | 'sampler'
  | 'external'

export interface Binding {
  group: number
  binding: number
  name: string
  space: BindingSpace
  type: string
}

const DECL =
  /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]*)>)?\s+(\w+)\s*:\s*([^;]+);/g

function spaceOf(qualifier: string | undefined, type: string): BindingSpace {
  const q = (qualifier ?? '').replace(/\s/g, '')
  if (q === 'uniform') return 'uniform'
  if (q === 'storage' || q === 'storage,read') return 'storage'
  if (q === 'storage,read_write') return 'storage_rw'
  if (type.startsWith('texture_storage')) return 'storage_texture'
  if (type.startsWith('texture_external')) return 'external'
  if (type.startsWith('texture')) return 'texture'
  if (type.startsWith('sampler')) return 'sampler'
  throw new Error(`unknown binding space: var<${q}> ${type}`)
}

export function reflectBindings(wgsl: string): Binding[] {
  const src = wgsl.replace(/\/\/[^\n]*/g, '')
  const out: Binding[] = []
  for (const m of src.matchAll(DECL)) {
    const type = m[5].trim()
    out.push({
      group: Number(m[1]),
      binding: Number(m[2]),
      name: m[4],
      space: spaceOf(m[3], type),
      type,
    })
  }
  return out.toSorted((a, b) => a.group - b.group || a.binding - b.binding)
}
