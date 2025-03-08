#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// List of Hono submodules that need symlinks
const submodules = [
  'logger',
  'cors',
  'html',
  'http-exception',
  'body-limit',
  'streaming',
  'utils/filepath',
  'utils/mime',
]

async function ensureDirectoryExists(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true })
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err
    }
  }
}

async function main() {
  const nodeModulesPath = path.resolve(__dirname, 'node_modules')
  const honoPath = path.resolve(nodeModulesPath, 'hono')

  try {
    // Check if Hono exists
    await fs.access(honoPath)

    // Create directories for each submodule
    for (const submodule of submodules) {
      const submodulePath = path.resolve(honoPath, submodule)
      const parts = submodule.split('/')

      if (parts.length > 1) {
        // Handle nested paths like utils/filepath
        await ensureDirectoryExists(path.resolve(honoPath, parts[0]))
      }

      await ensureDirectoryExists(submodulePath)

      // Create an index.js in each submodule directory
      const indexPath = path.resolve(submodulePath, 'index.js')
      let targetImport

      if (parts.length > 1) {
        // For nested modules like utils/filepath
        targetImport = `@hono/${parts[0]}`
      } else {
        targetImport = `@hono/${submodule}`
      }

      const content = `export * from '${targetImport}';\n`
      await fs.writeFile(indexPath, content)

      console.log(`Created symlink for ${submodule}`)
    }

    console.log('Hono submodule setup complete')
  } catch (err) {
    console.error('Error setting up Hono submodules:', err)
    process.exit(1)
  }
}

main()
