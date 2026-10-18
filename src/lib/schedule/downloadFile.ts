interface FileSystemWritableFileStreamLike {
  write(data: BlobPart): Promise<void>
  close(): Promise<void>
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>
  }
}

/**
 * Saves `blob` to disk. Chromium browsers implement the File System Access
 * API, which pops a native "Save As" dialog the user can point at any
 * folder (and which the browser tends to remember for this site next time)
 * — Firefox and Safari don't implement it, so this falls back to a classic
 * `<a download>` link there, which always lands wherever the browser's own
 * download setting points. There's no way for a page to silently choose a
 * destination folder itself — that's a deliberate browser security boundary,
 * not a gap in this implementation.
 */
export async function saveFile(blob: Blob, filename: string, description: string): Promise<void> {
  if (window.showSaveFilePicker) {
    try {
      const extension = filename.slice(filename.lastIndexOf('.'))
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description, accept: { [blob.type]: [extension] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return // user cancelled the picker — not an error
      // Any other failure (unsupported options, permission denied): fall through to the classic download below.
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
