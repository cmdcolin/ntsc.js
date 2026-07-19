export interface Gpu {
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
}

export async function initGpu(canvas: HTMLCanvasElement): Promise<Gpu> {
  if (!navigator.gpu) throw new Error('WebGPU not available in this browser')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('No WebGPU adapter found')
  const device = await adapter.requestDevice()
  device.addEventListener('uncapturederror', (e) => {
    console.error('WebGPU uncaptured:', (e as GPUUncapturedErrorEvent).error.message)
  })
  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('Could not get webgpu canvas context')
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque' })
  return { device, context, format }
}
