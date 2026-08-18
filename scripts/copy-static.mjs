import { cp, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const copy = async (from, to) => {
  await mkdir(dirname(to), { recursive: true })
  await cp(from, to)
}

await copy(resolve(root, 'src/recovery/index.html'), resolve(root, 'dist/recovery/index.html'))
await copy(resolve(root, 'assets/narwhal-icon.png'), resolve(root, 'dist/renderer/assets/narwhal-icon.png'))
await copy(resolve(root, 'assets/narwhal-tray.png'), resolve(root, 'dist/renderer/assets/narwhal-tray.png'))
