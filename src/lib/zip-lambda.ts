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
const _excludes = [
    ...defaultFiles,
    ...defaultDirectories.map((dir) => `**/${dir}/**`),
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

export async function zipLambda(zipdir: string, outdir: string) {
    await spawnAsync(
        'deterministic-zip',
        [
            `${zipdir}.zip`,
            '.',
            '--recurse-paths',
            ..._excludes.flatMap((x) => ['-x', `"**/${x}"`]),
            ..._nodeModulesExcludes.flatMap((x) => ['-x', `"node_modules/**/${x}"`]),
        ],
        {
            stdio: 'inherit',
            cwd: outdir,
        },
    )
}

export async function initZip() {
    await spawnAsync('deterministic-zip', ['--version'], {}).catch(() =>
        spawnAsync('pipx', ['install', 'deterministic-zip-go', '--quiet'], {
            stdio: 'ignore',
        }).catch(() => void {}),
    )
}
