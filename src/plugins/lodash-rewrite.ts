import type { Plugin, PluginBuild } from 'esbuild'

import _fs from 'node:fs'

export function lodashRewritePlugin(options: { filter?: RegExp; outLodashPackage?: string } = {}): Plugin {
    const { filter = /.*/, outLodashPackage = 'lodash' } = options
    const onLoad = setupLodashRewriteOnLoad(outLodashPackage)

    return {
        name: 'lodash-import-rewrite',
        setup(build) {
            build.onLoad({ filter }, onLoad)
        },
    }
}

const lodashImportRegex = /import\s*(?:(?:(?:[\w*\s{},\n]*)\s*from\s*)|)['"](?:(?:lodash\/?.*?))['"]\s*(?:;|$|)/gm
const lodashRequireRegex =
    /const\s*(?:(?:(?:[\w*\s{},\n]*)\s*=\s*require\s*\(\s*)|)['"](?:(?:lodash\/?.*?))['"]\s*\)\s*(?:;|$|)/gm
const destructuredImportRegex = /\{\s?(((\w+),?[\s\n]?)+)\}/gm

export const setupLodashRewriteOnLoad = (outLodashPackage: string): Parameters<PluginBuild['onLoad']>[1] => {
    return async (args, fs: { promises: Pick<typeof _fs.promises, 'readFile'> } = _fs) => {
        const contents = await fs.promises.readFile(args.path, 'utf8')

        const lodashImports = lodashImportRegex.exec(contents) ?? []
        const lodashRequires = lodashRequireRegex.exec(contents) ?? []

        if (lodashImports.length === 0 && lodashRequires.length === 0) {
            return
        }

        let finalContents = contents
        for (const line of lodashImports) {
            finalContents = rewriteImport({
                line,
                contents: finalContents,
                outLodashPackage,
                toImport: (name, from) => `import ${name} from '${from}';`,
            })
        }
        for (const line of lodashRequires) {
            finalContents = rewriteImport({
                line,
                contents: finalContents,
                outLodashPackage,
                toImport: (name, from) => `const ${name} = require('${from}');`,
            })
        }
        return {
            contents: finalContents,
            loader: args.path.endsWith('.ts') ? 'ts' : 'js',
        }
    }
}

function rewriteImport({
    line,
    contents,
    outLodashPackage,
    toImport,
}: {
    line: string
    contents: string
    outLodashPackage: string
    toImport: (name: string, from: string) => string
}): string {
    // Capture content inside curly braces within imports
    const destructuredImports = line.match(destructuredImportRegex)
    // For example:
    // import noop from 'lodash/noop';
    if (!destructuredImports) {
        return contents
    }
    // For example:
    // import { noop, isEmpty, debounce as _debounce } from 'lodash';
    const importNames = destructuredImports[0]
        .replace(/[{}]/g, '')
        .split(',')
        .map((name) => name.trim())

    const result = importNames
        .map((name) => {
            if (name.includes(' as ')) {
                const [realName, alias] = name.split(' as ') as [string, string]
                return toImport(alias, `${outLodashPackage}/${realName}`)
            } else {
                return toImport(name, `${outLodashPackage}/${name}`)
            }
        })
        .join('\n')

    return contents.replace(line, result)
}
