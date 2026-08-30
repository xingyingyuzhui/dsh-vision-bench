declare module 'write-file-atomic' {
  const writeFileAtomic: {
    sync(filename: string, data: string | Buffer, options?: { encoding?: string; fsync?: boolean }): void
  }
  export default writeFileAtomic
}
