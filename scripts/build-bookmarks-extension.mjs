import {fileURLToPath} from 'node:url'
import {zipDirectory} from './zip-directory.mjs'

await zipDirectory(fileURLToPath(new URL('../extension/', import.meta.url)), fileURLToPath(new URL('../public/dada-bookmarks-extension.zip', import.meta.url)))
