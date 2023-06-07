import type { Plugin, PluginBuild } from 'esbuild'

import _fs from 'node:fs'

export function importRewritePlugin(options: { filter?: RegExp; importName: string; outImportName?: string }): Plugin {
    const { filter = /.*/, importName } = options
    const outImportName = options.outImportName ?? importName
    const onLoad = setupImportRewriteOnLoad(importName, outImportName)

    return {
        name: 'import-rewrite',
        setup(build) {
            build.onLoad({ filter }, onLoad)
        },
    }
}

export const setupImportRewriteOnLoad = (
    importName: string,
    outImportName: string,
    fs: { promises: Pick<typeof _fs.promises, 'readFile'> } = _fs
): Parameters<PluginBuild['onLoad']>[1] => {
    return async (args) => {
        const contents = await fs.promises.readFile(args.path, 'utf8')

        const importRegex = new RegExp(
            `import\\s*(?:(?:[\\w\\s{},]*\\s*from\\s*)|)['"]${importName}\\/?.*?['"]\\s*?(?:;|$|)`,
            'gm'
        )
        const matchedImports = importRegex.exec(contents) ?? []

        const requireRegex = new RegExp(
            `const\\s*(?:[\\w\\s{},]*\\s*=\\s*require\\s*\\(\\s*)['"]${importName}\\/?.*?['"]\\s*\\)\\s*?(?:;|$|)`,
            'gm'
        )
        const matchedRequires = requireRegex.exec(contents) ?? []

        if (matchedImports.length === 0 && matchedRequires.length === 0) {
            return
        }

        let finalContents = contents
        for (const line of matchedImports) {
            finalContents = rewriteImport({
                line,
                contents: finalContents,
                outImportName,
                toImport: (name, from) => `import ${name} from '${from}';`,
            })
        }
        for (const line of matchedRequires) {
            finalContents = rewriteImport({
                line,
                contents: finalContents,
                outImportName,
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
    outImportName,
    toImport,
}: {
    line: string
    contents: string
    outImportName: string
    toImport: (name: string, from: string) => string
}): string {
    const destructuredImportRegex = /\{(?:\s*\w+\s*,?)+\s*\}/gm
    // Capture content inside curly braces within imports
    const destructuredImports = destructuredImportRegex.exec(line)
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
                return toImport(alias, `${outImportName}/${realName}`)
            } else {
                return toImport(name, `${outImportName}/${name}`)
            }
        })
        .join('\n')

    return contents.replace(line, result)
}
