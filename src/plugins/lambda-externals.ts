import type { Plugin } from 'esbuild'

import child_process from 'child_process'
import fs from 'fs'
import path from 'path'

function determinePackageName(fullPath: string): string {
    const split = fullPath.split('/')
    if (fullPath.startsWith('@')) {
        return split.slice(0, 2).join('/')
    }
    return split[0]
}

export function lambdaExternalsPlugin({ root, packageJson }: { root: string; packageJson: Record<string, unknown> }): Plugin {
    return {
        name: 'lambda-externals',
        setup: (compiler) => {
            const externals: Record<string, string> = {}

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

                // Finally, it it's NEITHER a relative import NOR a node built-in libary, determine the relevant version for the Lambda handler
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
                externals[packageName] = require(`${packageName}/package.json`).version
                return null
            })
            compiler.onEnd(async (result) => {
                for (const artifactDir of new Set(
                    Object.keys(result.metafile?.outputs ?? {}).map((f) => path.dirname(path.join(root, f)))
                )) {
                    await Promise.all([
                        // Write the newly generated package with narrow `externals` as dependencies
                        fs.promises.writeFile(
                            path.join(artifactDir, 'package.json'),
                            JSON.stringify(
                                {
                                    ...packageJson,
                                    devDependencies: undefined,
                                    scripts: undefined,
                                    files: undefined,
                                    dependencies: externals,
                                },
                                null,
                                2
                            )
                        ),
                        // copy the lockfile for extra safety
                        fs.promises.copyFile(path.join(root, 'package-lock.json'), path.join(artifactDir, 'package-lock.json')),
                    ])
                    await new Promise((resolve, reject) => {
                        const p = child_process.exec('npm ci', { cwd: artifactDir }, (err, stdout) =>
                            err ? reject(err) : resolve(stdout)
                        )
                        p.on('error', reject)
                    })

                    // HOTFIX: remove aws-sdk that might have transitively been included
                    await fs.promises
                        .rm(path.join(artifactDir, 'node_modules', 'aws-sdk'), { recursive: true, force: true })
                        .catch(() => void {})
                }
            })
        },
    }
}
