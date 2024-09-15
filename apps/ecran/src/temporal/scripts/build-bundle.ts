import * as esbuild from 'esbuild'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const packageJson = require('../../../package.json')

async function buildBundle() {
  try {
    const worker = await esbuild.build({
      entryPoints: ['src/temporal/worker.ts'],
      bundle: true,
      outfile: 'src/temporal/worker.cjs',
      format: 'cjs',
      target: 'node18',
      platform: 'node',
      sourcemap: 'both',
      preserveSymlinks: true,
      minify: false,
      logLevel: 'debug',
      external: Object.keys(packageJson.dependencies),
    })

    console.log('Bundle built successfully:', worker)
  } catch (error) {
    console.error('Error building bundle:', error)
    process.exit(1)
  }
}

buildBundle().catch(console.error)
