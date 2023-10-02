import { mapTry, recoverTry } from '@skyleague/axioms'
import type { Plugin } from 'esbuild'

import child_process from 'node:child_process'
import fs from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

function determinePackageName(fullPath: string): string {
    const split = fullPath.split('/')
    if (fullPath.startsWith('@')) {
        return split.slice(0, 2).join('/')
    }
    return split[0]!
}

export function getImportPath(packagePath: string) {
    return path.isAbsolute(packagePath) ? pathToFileURL(packagePath).href : packagePath
}

export function lambdaExternalsPlugin({
    root,
    packageJson,
    awsSdkV3,
    forceBundle,
}: {
    root: string
    packageJson: Record<string, unknown>
    awsSdkV3: boolean
    forceBundle: ((input: { packageName: string; path: string }) => boolean) | undefined
}): Plugin {
    return {
        name: 'lambda-externals',
        setup: (compiler) => {
            const externals: Record<string, string> = {}

            compiler.onResolve({ namespace: 'file', filter: /.*/ }, async (args) => {
                if (args.path.startsWith('.')) {
                    // relative import's don't need to be added to the package.json
                    return null
                }

                const packageName = determinePackageName(args.path)
                if (
                    (recoverTry(
                        // For some packages missing both `main` and `exports`, require.resolve will fail
                        mapTry(packageName, (p) => p === require.resolve(p)),
                        () => false
                    ) as boolean) ||
                    isBuiltin(packageName)
                ) {
                    // this detects node built-in libraries like fs, path, etc, we don't need to add those to the package.json
                    return null
                }
                if (forceBundle?.({ packageName, path: args.path }) === true) {
                    // forceBundled dependencies will not be marked as external
                    return null
                }
                if (awsSdkV3) {
                    if (packageName.startsWith('@aws-sdk/')) {
                        // forcefully mark @aws-sdk/* as external
                        return { path: args.path, external: true }
                    }
                } else {
                    if (packageName === 'aws-sdk') {
                        // forcefully mark aws-sdk as external
                        return { path: args.path, external: true }
                    }
                }

                // Finally, it it's NEITHER a relative import NOR a node built-in libary, determine the relevant version for the Lambda handler
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    externals[packageName] = await import(
                        getImportPath(path.join(root, 'node_modules', packageName, 'package.json')),
                        {
                            assert: { type: 'json' },
                        }
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
                    ).then((res: any): any => (res.default ?? res).version)
                } catch (err) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    externals[packageName] = await import(getImportPath(path.join(packageName, 'package.json')), {
                        assert: { type: 'json' },
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
                    }).then((res: any): any => (res.default ?? res).version)
                }
                return { path: args.path, external: true }
            })
            compiler.onEnd(async (result) => {
                for (const artifactDir of new Set(
                    Object.keys(result.metafile?.outputs ?? {}).map((f) => path.dirname(path.join(root, f)))
                )) {
                    const lambdaPackageJson = {
                        name: packageJson.name,
                        type: packageJson.type,
                        sideEffects: packageJson.sideEffects,
                        dependencies: Object.fromEntries(Object.entries(externals).sort(([a], [b]) => a.localeCompare(b))),
                    }
                    await Promise.all([
                        // Write the newly generated package with narrow `externals` as dependencies
                        fs.promises.writeFile(path.join(artifactDir, 'package.json'), JSON.stringify(lambdaPackageJson, null, 2)),
                        // copy the lockfile for extra safety
                        fs.promises.copyFile(path.join(root, 'package-lock.json'), path.join(artifactDir, 'package-lock.json')),
                    ])
                    await new Promise((resolve, reject) => {
                        const p = child_process.exec('npm ci --omit=dev --omit=optional', { cwd: artifactDir }, (err, stdout) =>
                            err ? reject(err) : resolve(stdout)
                        )
                        p.on('error', reject)
                    })

                    if (!awsSdkV3) {
                        const awsSdkDir = path.join(artifactDir, 'node_modules', 'aws-sdk')
                        if (
                            await fs.promises
                                .stat(awsSdkDir)
                                .then(() => true)
                                .catch(() => false)
                        ) {
                            await fs.promises.writeFile(
                                path.join(artifactDir, 'package.json'),
                                JSON.stringify(
                                    {
                                        ...lambdaPackageJson,
                                        overrides: {
                                            'aws-sdk': './__non_existing__',
                                        },
                                    },
                                    null,
                                    2
                                )
                            )
                            // HOTFIX: remove aws-sdk that might have transitively been included
                            await new Promise((resolve, reject) => {
                                const p = child_process.exec('npm i --cache', { cwd: artifactDir }, (err, stdout) =>
                                    err ? reject(err) : resolve(stdout)
                                )
                                p.on('error', reject)
                            })
                        }
                    }
                }
            })
        },
    }
}
