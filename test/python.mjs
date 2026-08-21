import { execFileSync } from 'node:child_process'

const names = process.platform === 'win32'
  ? ['py', 'python', 'python3']
  : ['python3', 'python']

export const findPython = () => {
  for (const bin of names) {
    const args = bin === 'py' || bin === 'py.exe'
      ? ['-3', '-c', 'import sys; print(sys.executable)']
      : ['-c', 'import sys; print(sys.executable)']
    try {
      const out = execFileSync(bin, args, {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
      }).trim()
      const line = out.split(/\r?\n/).filter(Boolean).pop()
      if (line) return line
    } catch { /* next candidate */ }
  }
  return ''
}
