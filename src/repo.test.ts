import { execSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('has no compiled .js next to the TypeScript sources', () => {
  // A stray vite.config.js wins over vite.config.ts, and src/*.js shadows extensionless imports.
  const files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n')
  expect(files.filter((f) => /^(src\/.*|vite\.config)\.js$/.test(f))).toEqual([])
})
