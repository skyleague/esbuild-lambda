import type { Plugin } from 'esbuild'

import child_process from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function determinePackageName(fullPath: string): string {
    const split = fullPath.split('/')
    if (fullPath.startsWith('@')) {
        return split.slice(0, 2).join('/')
    }
    return split[0]!
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
            const externals: Record<string, string> = {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
                'source-map-support': require('source-map-support/package.json').version,
            }

            compiler.onResolve({ namespace: 'file', filter: /.*/ }, (args) => {
                if (args.path.startsWith('.')) {
                    // relative import's don't need to be added to the package.json
                    return null
                }

                const packageName = determinePackageName(args.path)
                if (packageName === require.resolve(packageName)) {
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
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
                    externals[packageName] = require(path.join(root, 'node_modules', packageName, 'package.json')).version
                } catch (err) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
                    externals[packageName] = require(path.join(packageName, 'package.json')).version
                }
                return { path: args.path, external: true }
            })
            compiler.onEnd(async (result) => {
                for (const artifactDir of new Set(
                    Object.keys(result.metafile?.outputs ?? {}).map((f) => path.dirname(path.join(root, f)))
                )) {
                    const lambdaPackageJson = {
                        ...packageJson,
                        devDependencies: undefined,
                        scripts: undefined,
                        files: undefined,
                        dependencies: externals,
                    }
                    await Promise.all([
                        // Write the newly generated package with narrow `externals` as dependencies
                        fs.promises.writeFile(path.join(artifactDir, 'package.json'), JSON.stringify(lambdaPackageJson, null, 2)),
                        // copy the lockfile for extra safety
                        fs.promises.copyFile(path.join(root, 'package-lock.json'), path.join(artifactDir, 'package-lock.json')),
                    ])
                    await new Promise((resolve, reject) => {
                        const p = child_process.exec('npm ci', { cwd: artifactDir }, (err, stdout) =>
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
