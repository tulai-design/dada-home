import {readdir, readFile, mkdir, writeFile} from 'node:fs/promises'
import {deflateRawSync} from 'node:zlib'
import path from 'node:path'

const CRC_TABLE = Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
const crc32 = bytes => {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

/** 仅打包受控构建目录；不依赖云端或开发机安装 zip 命令。 */
export async function zipDirectory(directory, destination) {
  const names = []
  async function visit(relative = '') {
    for (const item of (await readdir(path.join(directory, relative), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name === '.DS_Store' || item.name.endsWith('.map')) continue
      const name = path.posix.join(relative, item.name)
      if (item.isDirectory()) await visit(name)
      else if (item.isFile()) names.push(name)
      else throw new Error(`扩展打包不接受符号链接或特殊文件：${name}`)
    }
  }
  await visit()
  const parts = [], central = []
  let offset = 0
  for (const name of names) {
    const filename = Buffer.from(name, 'utf8')
    const data = await readFile(path.join(directory, name)), compressed = deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0x0021, 12) // 固定日期 1980-01-01，保证相同内容得到同一 ZIP。
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(filename.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0x0021, 14)
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42)
    central.push(entry, filename)
    parts.push(local, filename, compressed)
    offset += local.length + filename.length + compressed.length
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16)
  await mkdir(path.dirname(destination), {recursive: true})
  await writeFile(destination, Buffer.concat([...parts, index, end]))
}
