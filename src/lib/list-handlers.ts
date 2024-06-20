import { getImportPath } from '../plugins/index.js'

import { asyncCollect, parallelLimit } from '@skyleague/axioms'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface Options {
    fileName?: string | undefined
    isHandler?: ((mod: object) => boolean) | undefined
}

const pLimit = parallelLimit(Math.max(os.cpus().length, 2))
export async function* listLambdaHandlersGenerator(
    dir: string,
    { fileName = 'index.ts', isHandler }: Options = {},
): AsyncGenerator<string, void> {
    const subs = await Promise.all(
        (await fs.promises.readdir(dir))
            .filter((sub) => !sub.startsWith('.'))
            .map((sub) => path.join(dir, sub))
            .map(async (sub) => ({ sub, stat: await pLimit(() => fs.promises.stat(sub)) })),
    )
    const index = subs.find((s) => s.sub.endsWith(`${path.sep}${fileName}`))
    if (index !== undefined) {
        if (isHandler !== undefined) {
            if (isHandler(await import(getImportPath(index.sub)))) {
                yield dir
            }
        } else {
            const contents = (await fs.promises.readFile(index.sub)).toString()
            // check if there is any symbol named handler exported
            // we need an exaustive check for all posible export types
            // and formatting
            if (
                contents.match(
                    /export\s+(?:default\s+)?(?:async\s+)?function\s+handler\s*\(|export\s+const\s+handler\s*=\s*|export\s*\{\s*handler\s*(?:,\s*\w+\s*)?\}(?:\s*from\s*['"][^'"]+['"])?\s*;?|module\.exports\.handler\s*=\s*handler\s*;?/,
                )
            ) {
                yield dir
            }
        }
    }
    for (const sub of subs.filter((s) => s.stat.isDirectory())) {
        yield* listLambdaHandlersGenerator(sub.sub, { fileName, isHandler })
    }
}

export function listLambdaHandlers(dir: string, options: Partial<Options> = {}): Promise<string[]> {
    return asyncCollect(listLambdaHandlersGenerator(dir, options))
}
