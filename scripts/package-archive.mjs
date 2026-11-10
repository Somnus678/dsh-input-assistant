import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

/** Read ordinary package tar entries without extracting or executing archive content. */
export async function readPackageArchive(archive) {
  const tar = gunzipSync(await readFile(archive), { maxOutputLength: 64 * 1024 * 1024 })
  const entries = new Map(), names = new Set()
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const text = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '')
    const name = text(0, 100), prefix = text(345, 500), entry = prefix ? `${prefix}/${name}` : name
    const octal = text(124, 136).trim()
    if (!/^[0-7]*$/.test(octal)) throw new Error('Invalid archive entry size')
    const size = Number.parseInt(octal || '0', 8), type = header[156]
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Archive entry exceeds tar bounds')
    if (entry.includes('\\') || !entry.startsWith('package/') || entry.split('/').some(part => part === '..' || part === '.' || part.includes(':'))) throw new Error('Unsafe package archive path')
    if (type !== 0 && type !== 48 && type !== 53) throw new Error('Archive links and special entries are not supported')
    if (type !== 53) {
      if (names.has(entry.toLowerCase())) throw new Error(`Duplicate archive path: ${entry}`)
      names.add(entry.toLowerCase())
      entries.set(entry, tar.subarray(offset + 512, offset + 512 + size).toString('utf8'))
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}
