declare global {
  type FileSystemPermissionMode = "read" | "readwrite"

  interface FileSystemHandlePermissionDescriptor {
    mode?: FileSystemPermissionMode
  }

  type FileSystemPermissionState = "granted" | "denied" | "prompt"

  interface FileSystemHandle {
    readonly kind: "file" | "directory"
    readonly name: string
    queryPermission(
      descriptor?: FileSystemHandlePermissionDescriptor
    ): Promise<FileSystemPermissionState>
    requestPermission(
      descriptor?: FileSystemHandlePermissionDescriptor
    ): Promise<FileSystemPermissionState>
    isSameEntry(other: FileSystemHandle): Promise<boolean>
  }

  interface FileSystemCreateWritableOptions {
    keepExistingData?: boolean
  }

  interface FileSystemGetFileOptions {
    create?: boolean
  }

  interface FileSystemGetDirectoryOptions {
    create?: boolean
  }

  interface FileSystemRemoveOptions {
    recursive?: boolean
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: FileSystemWriteChunkType): Promise<void>
    seek(position: number): Promise<void>
    truncate(size: number): Promise<void>
    close(): Promise<void>
  }

  type FileSystemWriteChunkType =
    | BufferSource
    | Blob
    | string
    | {
        type: "write"
        position?: number
        data: BufferSource | Blob | string
      }
    | {
        type: "seek"
        position: number
      }
    | {
        type: "truncate"
        size: number
      }

  interface FileSystemFileHandle extends FileSystemHandle {
    readonly kind: "file"
    getFile(): Promise<File>
    createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>
  }

  interface FileSystemDirectoryHandle extends FileSystemHandle {
    readonly kind: "directory"
    getDirectoryHandle(
      name: string,
      options?: FileSystemGetDirectoryOptions
    ): Promise<FileSystemDirectoryHandle>
    getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle>
    removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void>
    resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    values(): AsyncIterableIterator<FileSystemHandle>
    keys(): AsyncIterableIterator<string>
    [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>
  }

  interface DirectoryPickerOptions {
    id?: string
    mode?: FileSystemPermissionMode
    startIn?: FileSystemHandle | WellKnownDirectory
  }

  type WellKnownDirectory = "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos"

  interface Window {
    showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
  }
}

export {}
