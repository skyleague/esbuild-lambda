import { jsonPlugin, lambdaEntryPlugin, lambdaExternalsPlugin } from '../plugins'

import type { BuildOptions, Plugin } from 'esbuild'
import { build } from 'esbuild'

import fs from 'fs'
import path from 'path'

interface BuildLambdaOptions {
    root: string
    outdir?: (context: { fnDir: string; root: string }) => string
    forceBundle?: (input: { packageName: string; path: string }) => boolean
    entryPoint?: (fnDir: string) => string
    lambdaEntry?: {
        features?: {
            xray?: boolean
            sourceMapSupport?: boolean
        }
    }
    plugins?: {
        pre?: Plugin[]
        post?: Plugin[]
    }
    esbuild?: BuildOptions
}
export async function esbuildLambda(fnDir: string, options: BuildLambdaOptions): Promise<void> {
    const { root, forceBundle } = options
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
            lambdaEntryPlugin(options.lambdaEntry?.features),
            lambdaExternalsPlugin({ root, packageJson, forceBundle }),
            ...(options.plugins?.post ?? []),
        ],
        entryPoints: [options.entryPoint?.(fnDir) ?? path.join(fnDir, `index.ts`)],
        outdir: options.outdir?.({ fnDir, root }) ?? path.join(fnDir, '.build/artifacts'),
    })
    console.timeEnd(`${path.relative(root, fnDir)}\ntotal`)
}
