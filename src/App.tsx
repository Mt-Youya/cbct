import { useCallback, useEffect, useRef, useState } from 'react'
import { ClinicalBar } from './ui/ClinicalBar'
import { LoadingOverlay } from './ui/LoadingOverlay'
import { SettingsDrawer } from './ui/SettingsDrawer'
import { StatusBar } from './ui/StatusBar'
import { TopBar } from './ui/TopBar'
import { Workspace } from './ui/Workspace'
import { translate } from './i18n'
import { useViewerStore, type WorkspaceLayout } from './store/useViewerStore'

function readAllEntries(
  reader: FileSystemDirectoryReader,
  out: File[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    reader.readEntries((entries) => {
      if (!entries.length) return resolve()
      const next: Promise<void>[] = []
      for (const entry of entries) {
        if (entry.isFile) {
          next.push(
            new Promise((resolveFile) => {
              ;(entry as FileSystemFileEntry).file(
                (file) => {
                  out.push(file)
                  resolveFile()
                },
                () => resolveFile(),
              )
            }),
          )
        } else if (entry.isDirectory) {
          next.push(
            readAllEntries((entry as FileSystemDirectoryEntry).createReader(), out),
          )
        }
      }
      void Promise.all(next).then(() => readAllEntries(reader, out).then(resolve, reject))
    }, reject)
  })
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? [])
  const entries = items
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => Boolean(entry))
  if (!entries.length) return Array.from(dataTransfer.files ?? [])
  const out: File[] = []
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isFile) {
        const file = await new Promise<File | null>((resolve) => {
          ;(entry as FileSystemFileEntry).file(
            (f) => resolve(f),
            () => resolve(null),
          )
        })
        if (file) out.push(file)
      } else if (entry.isDirectory) {
        await readAllEntries((entry as FileSystemDirectoryEntry).createReader(), out)
      }
    }),
  )
  return out
}

const LAYOUT_ORDER: WorkspaceLayout[] = ['quad', 'mpr', '3d']

export default function App() {
  const importFiles = useViewerStore((s) => s.importFiles)
  const loadSample = useViewerStore((s) => s.load)
  const status = useViewerStore((s) => s.status)
  const lang = useViewerStore((s) => s.lang)
  const uiScale = useViewerStore((s) => s.uiScale)
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-font-scale', String(uiScale))
    document.documentElement.dataset.uiScale = 'on'
  }, [uiScale])

  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '')
    folderRef.current?.setAttribute('directory', '')
  }, [])

  useEffect(() => {
    const openFolder = () => folderRef.current?.click()
    const openFiles = () => filesRef.current?.click()
    const sample = () => void loadSample()
    window.addEventListener('cbct:import', openFolder)
    window.addEventListener('cbct:import-files', openFiles)
    window.addEventListener('cbct:sample', sample)
    return () => {
      window.removeEventListener('cbct:import', openFolder)
      window.removeEventListener('cbct:import-files', openFiles)
      window.removeEventListener('cbct:sample', sample)
    }
  }, [loadSample])

  const handleFiles = useCallback(
    (files: File[]) => {
      const dicomLike = files.filter((file) => !file.name.startsWith('.'))
      if (dicomLike.length) void importFiles(dicomLike)
    },
    [importFiles],
  )

  const onFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    handleFiles(files)
  }

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (status === 'loading') return
    const files = await collectDroppedFiles(event.dataTransfer)
    handleFiles(files)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const state = useViewerStore.getState()
      if (event.code === 'Space') {
        event.preventDefault()
        state.setAutoRotate(!state.autoRotate)
        return
      }
      if (event.key === 'g' || event.key === 'G') state.setShowGrid(!state.showGrid)
      if (event.key === 't' || event.key === 'T') state.setTeethOnly(!state.teethOnly)
      if (event.key === 's' || event.key === 'S') state.toggleSettings()
      if (event.key === 'l' || event.key === 'L') {
        const index = LAYOUT_ORDER.indexOf(state.layout)
        state.setLayout(LAYOUT_ORDER[(index + 1) % LAYOUT_ORDER.length])
      }
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= 8) {
        const presets = ['teeth', 'bone', 'dental', 'soft', 'mip', 'xray', 'heat', 'teal'] as const
        state.setPreset(presets[digit - 1])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div
      className="app flex flex-col"
      onDragOver={(event) => {
        event.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={(event) => void onDrop(event)}
    >
      <TopBar />
      <ClinicalBar />
      <Workspace />
      <StatusBar />
      <SettingsDrawer />
      <LoadingOverlay />

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[#03080d]/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-teal-300/60 px-10 py-8 text-center">
            <div className="font-mono text-[11px] tracking-[0.2em] text-teal-200">
              {translate(lang, 'start.drop')}
            </div>
            <div className="mt-2 font-mono text-[10px] text-[#7d93a8]">{translate(lang, 'start.formats')}</div>
          </div>
        </div>
      ) : null}

      <input
        ref={folderRef}
        type="file"
        multiple
        accept=".dcm,.DICOM,application/dicom"
        className="hidden"
        onChange={onFileInput}
      />
      <input
        ref={filesRef}
        type="file"
        multiple
        accept=".dcm,.DICOM,application/dicom"
        className="hidden"
        onChange={onFileInput}
      />
    </div>
  )
}
