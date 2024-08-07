import { mapTry, parallelLimit, recoverTry } from '@skyleague/axioms'
import type { Plugin } from 'esbuild'

import child_process from 'node:child_process'
import fs from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

function determinePackageName(fullPath: string): string {
    const split = fullPath.split('/')
    if (fullPath.startsWith('@')) {
        return split.slice(0, 2).join('/')
    }
    // biome-ignore lint/style/noNonNullAssertion: we know this is safe
    return split[0]!
}

export function getImportPath(packagePath: string) {
    return path.isAbsolute(packagePath) ? pathToFileURL(packagePath).href : packagePath
}

export function lambdaExternalsPlugin({
    root,
    modulesRoot,
    packageJson,
    forceBundle,
    packager = 'npm',
    parallelism = Math.max(os.cpus().length * 2, 4),
}: {
    root: string
    modulesRoot: string
    packageJson: Record<string, unknown>
    forceBundle: ((input: { packageName: string; path: string }) => boolean) | true | undefined
    packager?: 'npm' | 'bun' | undefined
    parallelism?: number
}): Plugin {
    return {
        name: 'lambda-externals',
        setup: (compiler) => {
            const externals: Record<string, Record<string, string>> = {}
            const bundled: Record<string, Record<string, string>> = {}

            const packageCache = new Map<string, Promise<string>>()

            compiler.onResolve({ namespace: 'file', filter: /.*/ }, async (args) => {
                if (args.path.startsWith('.')) {
                    // relative import's don't need to be added to the package.json
                    return null
                }

                const packageName = determinePackageName(args.path)
                if (
                    // For some packages with incorrect `main` or `exports`, require.resolve will fail
                    // These packages are not NodeJS built-in packages anyway
                    recoverTry(
                        // Only packages that are built-in will resolve to the same path with require.resolve
                        mapTry(packageName, (p) => p === require.resolve(p)),
                        () => false,
                    ) === true ||
                    isBuiltin(packageName)
                ) {
                    // this detects node built-in libraries like fs, path, etc, we don't need to add those to the package.json
                    return null
                }
                if (packageName.startsWith('@aws-sdk/')) {
                    // forcefully mark @aws-sdk/* as external
                    return { path: args.path, external: true }
                }

                const forceBundled = forceBundle === true ? true : forceBundle?.({ packageName, path: args.path }) === true
                const register = forceBundled ? bundled : externals

                register[args.importer] ??= {}

                // Finally, it it's NEITHER a relative import NOR a node built-in libary, determine the relevant version for the Lambda handler
                try {
                    const packagePath = getImportPath(path.join(modulesRoot, 'node_modules', packageName, 'package.json'))
                    if (packageCache.has(packagePath) === false) {
                        packageCache.set(
                            packagePath,
                            import(packagePath, {
                                with: { type: 'json' },
                            }).then((res) => (res.default ?? res).version),
                        )
                    }
                    // biome-ignore lint/style/noNonNullAssertion: we know this is safe
                    register[args.importer]![packageName] ??= await packageCache.get(packagePath)!
                } catch (_err) {
                    const packagePath = getImportPath(path.join(packageName, 'package.json'))
                    if (packageCache.has(packagePath) === false) {
                        packageCache.set(
                            packagePath,
                            import(packagePath, {
                                with: { type: 'json' },
                            })
                                .then((res) => (res.default ?? res).version)
                                .catch(() => undefined),
                        )
                    }
                    // biome-ignore lint/style/noNonNullAssertion: we know this is safe
                    register[args.importer]![packageName] ??= await packageCache.get(packagePath)!
                }

                if (forceBundled) {
                    // forceBundled dependencies will not be marked as external
                    return null
                }

                return { path: args.path, external: true }
            })
            compiler.onEnd(async (result) => {
                const pLimit = parallelLimit(parallelism)
                // biome-ignore lint/suspicious/noConfusingVoidType: it is correct here
                const promises: Promise<void | string>[] = []
                for (const [artifactDir, value] of Object.entries(result.metafile?.outputs ?? {}).map(
                    ([f, value]) => [path.dirname(path.join(root, f)), value] as const,
                )) {
                    const foundExternals = Object.fromEntries(
                        Object.keys(value.inputs).flatMap((input) =>
                            Object.entries(externals[path.join(modulesRoot, input)] ?? {}),
                        ),
                    )
                    const foundBundled = Object.fromEntries(
                        Object.keys(value.inputs).flatMap((input) =>
                            Object.entries(bundled[path.join(modulesRoot, input)] ?? {}),
                        ),
                    )

                    const lambdaPackageJson = {
                        name: packageJson.name,
                        type: packageJson.type,
                        sideEffects: packageJson.sideEffects,
                        dependencies: Object.fromEntries(Object.entries(foundExternals).sort(([a], [b]) => a.localeCompare(b))),
                        devDependencies: Object.fromEntries(Object.entries(foundBundled).sort(([a], [b]) => a.localeCompare(b))),
                    }

                    // Write the newly generated package with narrow `externals` as dependencies
                    await fs.promises.writeFile(
                        path.join(artifactDir, 'package.json'),
                        JSON.stringify(lambdaPackageJson, null, 2),
                    )
                    // copy the lockfile for extra safety
                    await fs.promises.copyFile(
                        path.join(modulesRoot, 'package-lock.json'),
                        path.join(artifactDir, 'package-lock.json'),
                    )

                    if (Object.keys(foundExternals).length > 0) {
                        if (packager === 'bun') {
                            promises.push(
                                pLimit(() => {
                                    console.log(`Installing dependencies for ${artifactDir}`)
                                    return new Promise((resolve, reject) => {
                                        const p = child_process.exec(
                                            'bun install --production --frozen-lockfile',
                                            { cwd: artifactDir },
                                            (err, stdout) => (err ? reject(err) : resolve(stdout)),
                                        )
                                        p.on('error', reject)
                                    })
                                }),
                            )
                        } else {
                            promises.push(
                                pLimit(() => {
                                    console.log(`Installing dependencies for ${artifactDir}`)
                                    return new Promise((resolve, reject) => {
                                        const p = child_process.exec(
                                            'npm ci --omit=dev --omit=optional --ignore-script',
                                            { cwd: artifactDir },
                                            (err, stdout) => (err ? reject(err) : resolve(stdout)),
                                        )
                                        p.on('error', reject)
                                    })
                                }),
                            )
                        }
                    }
                }
                await Promise.all(promises)
            })
        },
    }
}
