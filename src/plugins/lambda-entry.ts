import type { Plugin } from 'esbuild'

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
export const lambdaEntryPlugin: (features: { exports?: [string, ...string[]] }) => Plugin = ({ exports }) => ({
    name: 'lambda-entry-loader',
    setup: (compiler) => {
        const filter = /\.tsx?$/
        const namespace = 'lambda-entry'
        compiler.onResolve({ filter }, (args) => {
            if (args.kind === 'entry-point') {
                return { path: path.relative(process.cwd(), args.path), namespace }
            }
            return { path: require.resolve(args.path, { paths: [args.resolveDir] }) }
        })
        compiler.onLoad({ filter, namespace }, (args) => {
            return {
                resolveDir: path.resolve(process.cwd(), path.dirname(args.path)),
                contents: `export { ${exports?.join(', ') ?? 'handler'} } from './${path.basename(
                    args.path.replace(/\.ts$/, '.js'),
                )}'`,
                loader: 'ts',
            }
        })
        compiler.onEnd(async (result) => {
            await Promise.all(
                result.outputFiles?.map(async (file) => {
                    if (file.path.endsWith('.js') && file.text.includes('__require')) {
                        file.contents = Buffer.concat([
                            Buffer.from(`const require = (await import('node:module')).createRequire(import.meta.url);`),
                            file.contents,
                        ])
                    }
                    await fs.promises.mkdir(path.dirname(file.path), { recursive: true }).catch(() => void {})
                    await fs.promises.writeFile(file.path, file.contents)
                }) ?? [],
            )
        })
    },
})
