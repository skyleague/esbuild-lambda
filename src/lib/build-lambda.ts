import path from 'node:path'
import type { BuildOptions, Plugin } from 'esbuild'
import { build } from 'esbuild'
import { excludeVendorFromSourceMapPlugin } from '../plugins/exclude-source-map.js'
import { getImportPath, lambdaEntryPlugin, lambdaExternalsPlugin } from '../plugins/index.js'

interface BuildLambdaOptions {
    root?: string
    modulesRoot?: string
    outdir?: (context: { fnDir: string; root: string }) => string
    forceBundle?: ((input: { packageName: string; path: string }) => boolean) | true
    entryPoints?: string[]
    entryPoint?: (fnDir: string) => string
    lambdaEntry?: {
        features?: {
            exports?: [string, ...string[]]
        }
    }
    plugins?: {
        pre?: Plugin[]
        post?: Plugin[]
    }
    esbuild?: BuildOptions
    packager?: 'npm' | 'bun'
}
export async function esbuildLambda(fnDir: string, options: BuildLambdaOptions): Promise<void> {
    // biome-ignore lint/style/noNonNullAssertion: we know this is safe
    options.root ??= path.dirname(process.env.npm_package_json!)
    options.modulesRoot ??= process.env.npm_config_local_prefix ?? options.root
    const { root, modulesRoot, forceBundle, packager } = options

    const packageJson = await import(getImportPath(process.env.npm_package_json ?? `${root}/package.json`), {
        with: { type: 'json' },
    }).then((res: Record<string, unknown>) => (res.default ?? res) as Record<string, unknown>)

    console.time(`${path.relative(root, fnDir)}\ntotal`)

    await build({
        bundle: true,
        sourcemap: true,
        platform: 'node',
        metafile: true,
        treeShaking: true,
        write: false,
        format: 'esm',
        ...options.esbuild,
        loader: {
            '.json': 'json',
            '.map': 'empty',
            ...options.esbuild?.loader,
        },
        plugins: [
            ...(options.plugins?.pre ?? []),
            lambdaEntryPlugin({ ...options.lambdaEntry?.features }),
            lambdaExternalsPlugin({
                root,
                modulesRoot,
                packageJson,
                forceBundle,
                packager,
            }),
            excludeVendorFromSourceMapPlugin({ filter: /node_modules/ }),
            ...(options.plugins?.post ?? []),
        ],
        entryPoints: options?.entryPoints ?? [options.entryPoint?.(fnDir) ?? path.join(fnDir, 'index.ts')],
        outdir: options.outdir?.({ fnDir, root }) ?? path.join(fnDir, '.build/artifacts'),
    })
    console.timeEnd(`${path.relative(root, fnDir)}\ntotal`)
}
