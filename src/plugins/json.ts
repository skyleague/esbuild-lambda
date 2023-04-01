import type { Plugin } from 'esbuild'

import fs from 'node:fs'

export const jsonPlugin: Plugin = {
    name: 'json-loader',
    setup: (compiler) => {
        compiler.onLoad({ filter: /\.json$/ }, async (args) => {
            const content = await fs.promises.readFile(args.path, 'utf-8')
            return {
                contents: `module.exports = JSON.parse(${JSON.stringify(JSON.stringify(JSON.parse(content)))})`,
            }
        })
    },
}
