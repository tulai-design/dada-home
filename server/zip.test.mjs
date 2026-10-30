import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {zipDirectory} from '../scripts/zip-directory.mjs'

test('portable ZIP round-trips Unicode names and binary contents with no external packer', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dada-zip-'))
  try {
    const source = path.join(directory, 'source'), output = path.join(directory, 'extension.zip')
    await mkdir(path.join(source, 'assets'), {recursive: true})
    await writeFile(path.join(source, 'manifest.json'), '{"manifest_version":3}')
    await writeFile(path.join(source, '安装说明.txt'), '搭搭 🧩\n解压后加载扩展')
    const binary = Buffer.from([0, 1, 2, 128, 255, 13, 10])
    await writeFile(path.join(source, 'assets', 'binary.bin'), binary)
    await writeFile(path.join(source, '.DS_Store'), 'exclude')
    await writeFile(path.join(source, 'assets', 'chunk.js.map'), 'exclude')
    await zipDirectory(source, output)
    const first = await readFile(output)
    await zipDirectory(source, output)
    assert.deepEqual(await readFile(output), first, '同样内容的打包可重复')
    const listing = execFileSync('unzip', ['-Z1', output], {encoding: 'utf8'}).trim().split('\n')
    // macOS 自带旧 ZipInfo 会按本机 OEM 编码显示 UTF-8 名称；实际 ZIP 标记与内容按标准 UTF-8 保存。
    assert.equal(listing.length, 3)
    assert.ok(listing.includes('assets/binary.bin') && listing.includes('manifest.json'))
    assert.ok(first.includes(Buffer.from('安装说明.txt', 'utf8')))
    assert.deepEqual(execFileSync('unzip', ['-p', output, 'assets/binary.bin']), binary)
    assert.equal(execFileSync('unzip', ['-p', output, '*.txt'], {encoding: 'utf8'}), '搭搭 🧩\n解压后加载扩展')
    execFileSync('unzip', ['-t', output])
  } finally {await rm(directory, {recursive: true, force: true})}
})
