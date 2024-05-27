import { readFileSync } from 'node:fs'
import type { Plugin } from 'esbuild'

export const excludeVendorFromSourceMapPlugin: ({ filter }: { filter?: RegExp }) => Plugin = ({ filter = /node_modules/ }) => ({
    name: 'exclude-vendor-from-source-map',
    setup(build) {
        build.onLoad({ filter }, (args) => {
            if (args.path.endsWith('.js')) {
                return {
                    contents: `${readFileSync(
                        args.path,
                        'utf8',
                    )}\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIiJdLCJtYXBwaW5ncyI6IkEifQ==`,
                    loader: 'default',
                }
            }
            return undefined
        })
    },
})
