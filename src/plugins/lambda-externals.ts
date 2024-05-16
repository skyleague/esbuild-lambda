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
    packageManager = 'npm',
}: {
    root: string
    modulesRoot: string
    packageJson: Record<string, unknown>
    forceBundle: ((input: { packageName: string; path: string }) => boolean) | undefined
    packageManager?: 'npm' | 'bun'
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
                if (forceBundle?.({ packageName, path: args.path }) === true) {
                    // forceBundled dependencies will not be marked as external
                    return null
                }
                if (packageName.startsWith('@aws-sdk/')) {
                    // forcefully mark @aws-sdk/* as external
                    return { path: args.path, external: true }
                }

                // Finally, it it's NEITHER a relative import NOR a node built-in libary, determine the relevant version for the Lambda handler
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    externals[packageName] = await import(
                        getImportPath(path.join(modulesRoot, 'node_modules', packageName, 'package.json')),
                        {
                            assert: { type: 'json' },
                        }
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
                    ).then((res) => (res.default ?? res).version)
                } catch (_err) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    externals[packageName] = await import(getImportPath(path.join(packageName, 'package.json')), {
                        assert: { type: 'json' },
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
                    }).then((res) => (res.default ?? res).version)
                }
                return { path: args.path, external: true }
            })
            compiler.onEnd(async (result) => {
                for (const artifactDir of new Set(
                    Object.keys(result.metafile?.outputs ?? {}).map((f) => path.dirname(path.join(root, f))),
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
                        fs.promises.copyFile(
                            path.join(modulesRoot, 'package-lock.json'),
                            path.join(artifactDir, 'package-lock.json'),
                        ),
                    ])
                    if (packageManager === 'bun') {
                        await new Promise((resolve, reject) => {
                            const p = child_process.exec(
                                'bun install --production --frozen-lockfile',
                                { cwd: artifactDir },
                                (err, stdout) => (err ? reject(err) : resolve(stdout)),
                            )
                            p.on('error', reject)
                        })
                    } else {
                        await new Promise((resolve, reject) => {
                            const p = child_process.exec(
                                'npm ci --omit=dev --omit=optional',
                                { cwd: artifactDir },
                                (err, stdout) => (err ? reject(err) : resolve(stdout)),
                            )
                            p.on('error', reject)
                        })
                    }
                }
            })
        },
    }
}
