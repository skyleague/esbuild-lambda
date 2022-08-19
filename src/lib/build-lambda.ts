import { jsonPlugin, lambdaEntryPlugin, lambdaExternalsPlugin } from '../plugins'

import type { BuildOptions, Plugin } from 'esbuild'
import { build } from 'esbuild'

import fs from 'fs'
import path from 'path'

interface BuildLambdaOptions {
    root: string
    outdir?: (context: { fnDir: string; root: string }) => string
    externals?: (packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }) => string[]
    entryPoint?: (fnDir: string) => string
    plugins?: {
        pre?: Plugin[]
        post?: Plugin[]
    }
    esbuild?: BuildOptions
}
export async function esbuildLambda(fnDir: string, options: BuildLambdaOptions): Promise<void> {
    const { root } = options
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports
    const packageJson = require(`${root}/package.json`) as Partial<typeof import('../../package.json')>
    console.time(`${path.relative(root, fnDir)}\ntotal`)
    await fs.promises.rm(path.join(fnDir, '.build'), { recursive: true }).catch(() => void {})
    await build({
        bundle: true,
        sourcemap: true,
        platform: 'node',
        metafile: true,
        treeShaking: true,
        ...options.esbuild,

        plugins: [
            ...(options.plugins?.pre ?? []),
            jsonPlugin,
            lambdaEntryPlugin,
            lambdaExternalsPlugin({ root, packageJson }),
            ...(options.plugins?.post ?? []),
        ],
        entryPoints: [options.entryPoint?.(fnDir) ?? path.join(fnDir, `index.ts`)],
        external:
            options.externals?.(packageJson) ?? Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }),
        outdir: options.outdir?.({ fnDir, root }) ?? path.join(fnDir, '.build/artifacts'),
    })
    console.timeEnd(`${path.relative(root, fnDir)}\ntotal`)
}
