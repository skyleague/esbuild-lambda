import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { parallelLimit } from '@skyleague/axioms'
import zip, { type DeterministicZipCallback, type DeterministicZipOption } from 'deterministic-zip-ng'
import { spawnAsync } from './spawn.js'

const defaultFiles = [
    'Jenkinsfile',
    'Makefile',
    'Gulpfile.js',
    'Gruntfile.js',
    'gulpfile.js',
    '.DS_Store',
    '.tern-project',
    '.gitattributes',
    '.editorconfig',
    '.eslintrc',
    'eslint',
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintignore',
    '.stylelintrc',
    'stylelint.config.js',
    '.stylelintrc.json',
    '.stylelintrc.yaml',
    '.stylelintrc.yml',
    '.stylelintrc.js',
    '.htmllintrc',
    'htmllint.js',
    '.lint',
    '.npmrc',
    '.npmignore',
    '.jshintrc',
    '.flowconfig',
    '.documentup.json',
    '.yarn-metadata.json',
    '.travis.yml',
    'appveyor.yml',
    '.gitlab-ci.yml',
    'circle.yml',
    '.coveralls.yml',
    'CHANGES',
    'changelog',
    'LICENSE.txt',
    'LICENSE',
    'LICENSE-MIT',
    'LICENSE.BSD',
    'license',
    'LICENCE.txt',
    'LICENCE',
    'LICENCE-MIT',
    'LICENCE.BSD',
    'licence',
    'AUTHORS',
    'CONTRIBUTORS',
    '.yarn-integrity',
    '.yarnclean',
    '_config.yml',
    '.babelrc',
    '.yo-rc.json',
    'jest.config.js',
    'karma.conf.js',
    'wallaby.js',
    'wallaby.conf.js',
    '.prettierrc',
    '.prettierrc.yml',
    '.prettierrc.toml',
    '.prettierrc.js',
    '.prettierrc.json',
    'prettier.config.js',
    '.appveyor.yml',
    'tsconfig.json',
    'tslint.json',
]
const defaultDirectories = [
    '__tests__',
    'test',
    'tests',
    'powered-test',
    'docs',
    'doc',
    '.idea',
    '.vscode',
    'website',
    'images',
    'assets',
    'example',
    'examples',
    'coverage',
    '.nyc_output',
    '.circleci',
    '.github',
]

const defaultExtensions = ['.markdown', '.md', '.mkd', '.ts', '.jst', '.coffee', '.tgz', '.swp']

// https://github.com/tj/node-prune/blob/master/internal/prune/prune.go
const _nodejsExcludes = [
    ...defaultFiles,
    ...defaultDirectories.map((dir) => `**/${dir}/**`),
    ...defaultDirectories.map((dir) => `${dir}/**`),
    ...defaultExtensions.map((ext) => `*${ext}`),
    // '**/@aws-sdk/**',
    // '**/@smithy/**',
    // '**/@types/**',
    '*.d.ts',
    '*.d.ts.map',
    // files to exclude from the Lambda artifact
    '*.md',
    '.DS_Store',
    '*.html',
    '*.txt',
    '*.lock',
    'LICENSE',
    'license',
    '*.d.ts.map',
]

const _nodeModulesExcludes = [
    // files to exclude from node_modules in the Lambda artifact
    'package-lock.json',
]

const _pythonDirectoriesExcludes = ['*.dist-info', '__pycache__', 'botocore', 'boto3']

// Add new function to generate Python runtime-specific excludes
function getPythonRuntimeExcludes(runtime?: string) {
    // If no runtime specified, don't exclude any .so files
    if (!runtime) {
        return []
    }

    // Extract version from runtime (e.g., 'python3.10' -> '310')
    const version = runtime.replace(/[^0-9]/g, '')

    // Exclude all .so files except those matching our runtime
    return [
        // Exclude all .so files for other Python versions
        '**/*.cpython-37*.so',
        '**/*.cpython-38*.so',
        '**/*.cpython-39*.so',
        '**/*.cpython-310*.so',
        '**/*.cpython-311*.so',
        '**/*.cpython-312*.so',
        '**/*.cpython-313*.so',
    ].filter((pattern) => !pattern.includes(`cpython-${version}`))
}

const _pythonExcludes = [
    ...defaultExtensions.map((ext) => `*${ext}`),
    // Python-specific excludes
    ..._pythonDirectoriesExcludes.map((dir) => `**/${dir}/**`),
    ..._pythonDirectoriesExcludes.map((dir) => `${dir}/**`),
    '*.pyc',
    '*.pyo',
]

// Add supported Python runtime types
type PythonRuntime = 'python3.7' | 'python3.8' | 'python3.9' | 'python3.10' | 'python3.11' | 'python3.12'

// Update the type to include both Node.js and Python runtimes
type Runtime = 'nodejs18.x' | 'nodejs20.x' | PythonRuntime

export async function zipLambda(
    zipdir: string,
    fnBuildDir: string,
    {
        useFallback = true,
        runtime,
    }: {
        useFallback?: boolean
        runtime?: Runtime | undefined
    } = {},
) {
    const isPython = runtime?.startsWith('python')
    const runtimeExcludes = isPython ? getPythonRuntimeExcludes(runtime) : []

    if (!useFallback) {
        return spawnAsync(
            'deterministic-zip',
            [
                `${zipdir}.zip`,
                '.',
                '--recurse-paths',
                ...(isPython
                    ? [
                          ..._nodejsExcludes.flatMap((x) => ['-x', `"**/${x}"`]),
                          ..._pythonExcludes.flatMap((x) => ['-x', x]),
                          ...runtimeExcludes.flatMap((x) => ['-x', x]),
                      ]
                    : [
                          ..._nodejsExcludes.flatMap((x) => ['-x', `"**/${x}"`]),
                          ..._nodeModulesExcludes.flatMap((x) => ['-x', `"node_modules/**/${x}"`]),
                      ]),
            ],
            {
                stdio: 'inherit',
                cwd: fnBuildDir,
            },
        )
    }
    return promisify<string, string, DeterministicZipOption>(
        zip as unknown as (
            dir: string,
            destination: string,
            options: DeterministicZipOption,
            callback: DeterministicZipCallback,
        ) => void,
    )(fnBuildDir, `${zipdir}.zip`, {
        includes: ['./**'],
        excludes: isPython ? [..._pythonExcludes, ...runtimeExcludes] : _nodejsExcludes.flatMap((x) => ['-x', `"**/${x}"`]),
        cwd: fnBuildDir,
    })
}

export async function initZip() {
    let hasExternalZip = true
    await spawnAsync('deterministic-zip', ['--version'], {}).catch(() =>
        spawnAsync('pipx', ['install', 'deterministic-zip-go', '--quiet'], {
            stdio: 'ignore',
        }).catch(() => {
            hasExternalZip = false
            console.warn('deterministic-zip is not properly working, falling back to internal zip implementation')
        }),
    )
    return hasExternalZip
}

export async function zipHandlers(
    handlers: string[],
    {
        outbase,
        artifactDir,
        buildDir,
        runtime,
        parallelism = Math.max(os.cpus().length * 2, 4),
        transform,
    }: {
        outbase: string
        artifactDir: string
        buildDir: string
        parallelism?: number
        runtime?: Runtime
        transform?: (dirs: [fnZipDir: string, fnBuildDir: string]) => [fnZipDir: string, fnBuildDir: string]
    },
) {
    const hasExternalZip = await initZip()

    const directories = handlers
        .map((fnDir) => path.relative(outbase, fnDir))
        .map((fnDir) => {
            const fnZipDir = path.join(artifactDir, fnDir)
            const fnBuildDir = path.join(buildDir, fnDir)
            return [fnZipDir, fnBuildDir] as const
        })
        .map(([fnZipDir, fnBuildDir]) => transform?.([fnZipDir, fnBuildDir]) ?? ([fnZipDir, fnBuildDir] as const))

    await Promise.all(
        directories.map(async ([fnZipDir, _fnBuildDir]) => {
            await fsp.mkdir(path.dirname(fnZipDir), { recursive: true })
        }),
    )

    const pLimit = parallelLimit(parallelism)
    await Promise.all(
        directories.map(([fnZipDir, fnBuildDir]) => {
            console.log(`Zipping ${fnZipDir}`)
            return pLimit(() => zipLambda(fnZipDir, fnBuildDir, { useFallback: !hasExternalZip, runtime }))
        }),
    )
}
