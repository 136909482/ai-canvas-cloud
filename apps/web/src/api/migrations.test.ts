import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMigrationPackage, toOwnedArrayBuffer } from './migrations.ts'

function u16(value: number) {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff])
}

function u32(value: number) {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
}

function join(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.byteLength }
  return result
}

function storedZip(entries: Record<string, string>) {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let localOffset = 0
  for (const [path, text] of Object.entries(entries)) {
    const name = encoder.encode(path)
    const body = encoder.encode(text)
    const local = join([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(body.byteLength), u32(body.byteLength), u16(name.byteLength), u16(0), name, body,
    ])
    const central = join([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(body.byteLength), u32(body.byteLength), u16(name.byteLength), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(localOffset), name,
    ])
    locals.push(local); centrals.push(central); localOffset += local.byteLength
  }
  const central = join(centrals)
  const count = Object.keys(entries).length
  return join([...locals, central, u32(0x06054b50), u16(0), u16(0), u16(count), u16(count), u32(central.byteLength), u32(localOffset), u16(0)])
}

test('migration package parser reads fixed package files and asset bytes from a stored ZIP', async () => {
  const zip = storedZip({
    'manifest.json': JSON.stringify({ packageId: 'package-a' }),
    'project.json': JSON.stringify({ id: 'project-a' }),
    'graph.json': JSON.stringify({ nodes: [], edges: [] }),
    'assets.json': JSON.stringify({ schemaVersion: 1, assets: [{ filePath: 'assets/image.png' }] }),
    'assets/image.png': 'image-body',
  })

  const parsed = await parseMigrationPackage(new Blob([toOwnedArrayBuffer(zip)], { type: 'application/zip' }))

  assert.equal(parsed.manifest.packageId, 'package-a')
  assert.equal(parsed.projectRecord.id, 'project-a')
  assert.equal(new TextDecoder().decode(parsed.files.get('assets/image.png')), 'image-body')
  assert.deepEqual(parsed.archiveEntries.map((entry) => entry.path), [
    'manifest.json', 'project.json', 'graph.json', 'assets.json', 'assets/image.png',
  ])
})

test('migration package parser rejects archives without a central directory', async () => {
  await assert.rejects(() => parseMigrationPackage(new Blob(['not-a-zip'])), /ZIP 目录损坏/)
})
