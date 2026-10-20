import fs from 'node:fs'
import path from 'node:path'

const standaloneDir = path.resolve('.next/standalone')
const staticSource = path.resolve('.next/static')
const staticTarget = path.resolve('.next/standalone/.next/static')
const publicSource = path.resolve('public')
const publicTarget = path.resolve('.next/standalone/public')

if (fs.existsSync(standaloneDir)) {
  if (fs.existsSync(staticSource)) {
    fs.mkdirSync(path.dirname(staticTarget), { recursive: true })
    fs.cpSync(staticSource, staticTarget, { recursive: true })
    console.log('[build] Copied .next/static to .next/standalone/.next/static')
  }
  if (fs.existsSync(publicSource)) {
    fs.mkdirSync(path.dirname(publicTarget), { recursive: true })
    fs.cpSync(publicSource, publicTarget, { recursive: true })
    console.log('[build] Copied public to .next/standalone/public')
  }
}
