import { lambdaEntryPlugin, lambdaExternalsPlugin } from '../plugins/index.js'

import type { BuildOptions, Plugin } from 'esbuild'
import { build } from 'esbuild'

import fs from 'node:fs'
import path from 'node:path'

interface BuildLambdaOptions {
    root: string
    awsSdkV3?: true
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

    const packageJson = await import(`${root}/package.json`, { assert: { type: 'json' } }).then(
        (res: Record<string, unknown>) => (res.default ?? res) as Record<string, unknown>
    )
    console.time(`${path.relative(root, fnDir)}\ntotal`)
    await fs.promises.rm(path.join(fnDir, '.build'), { recursive: true }).catch(() => void {})
    await build({
        bundle: true,
        sourcemap: true,
        platform: 'node',
        metafile: true,
        treeShaking: true,
        format: 'esm',
        ...options.esbuild,
        loader: {
            '.json': 'json',
            ...options.esbuild?.loader,
        },
        plugins: [
            ...(options.plugins?.pre ?? []),
            lambdaEntryPlugin({ ...options.lambdaEntry?.features, esm: options.esbuild?.format !== 'cjs' }),
            lambdaExternalsPlugin({
                root,
                packageJson,
                forceBundle,
                awsSdkV3: options.awsSdkV3 ?? false,
            }),
            ...(options.plugins?.post ?? []),
        ],
        entryPoints: [options.entryPoint?.(fnDir) ?? path.join(fnDir, `index.ts`)],
        outdir: options.outdir?.({ fnDir, root }) ?? path.join(fnDir, '.build/artifacts'),
    })
    console.timeEnd(`${path.relative(root, fnDir)}\ntotal`)
}
