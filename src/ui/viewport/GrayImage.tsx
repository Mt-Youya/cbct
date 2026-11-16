import { useEffect, useRef } from 'react'
import type { GrayRaster } from '../../data/reslice'
import { useViewerStore } from '../../store/useViewerStore'

export function GrayImage({
  raster,
  label,
  marker,
  onPick,
}: {
  raster: GrayRaster
  label: string
  marker?: number
  onPick?: (column: number, row: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const range = useViewerStore((s) => s.volume?.quantRange)
  const center = useViewerStore((s) => s.windowCenter)
  const width = useViewerStore((s) => s.windowWidth)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !range) return
    const image = ctx.createImageData(raster.width, raster.height)
    const [qMin, qMax] = range
    const low = ((center - width / 2 - qMin) * 255) / (qMax - qMin)
    const scale = (qMax - qMin) / Math.max(1, width)
    for (let pixel = 0; pixel < raster.values.length; pixel++) {
      const gray = (raster.values[pixel] - low) * scale
      const at = pixel * 4
      image.data[at] = gray
      image.data[at + 1] = gray
      image.data[at + 2] = gray
      image.data[at + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    if (marker !== undefined) {
      ctx.fillStyle = 'rgba(45, 212, 191, 0.9)'
      ctx.fillRect(marker, 0, 1, raster.height)
    }
  }, [range, center, width, raster, marker])

  return (
    <canvas
      ref={ref}
      width={raster.width}
      height={raster.height}
      role="img"
      aria-label={label}
      className={`block h-full w-full object-contain ${onPick ? 'cursor-crosshair' : ''}`}
      onClick={onPick && ((event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const scale = Math.min(rect.width / raster.width, rect.height / raster.height)
        const x = (event.clientX - rect.left - (rect.width - raster.width * scale) / 2) / scale
        const y = (event.clientY - rect.top - (rect.height - raster.height * scale) / 2) / scale
        if (x >= 0 && y >= 0 && x < raster.width && y < raster.height) onPick(Math.floor(x), Math.floor(y))
      })}
    />
  )
}
