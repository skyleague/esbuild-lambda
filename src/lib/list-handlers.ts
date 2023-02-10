import { parallelLimit } from '@skyleague/axioms'

import fs from 'fs'
import os from 'os'
import path from 'path'

const pLimit = parallelLimit(Math.max(os.cpus().length, 2))
export async function listLambdaHandlers(dir: string): Promise<string[]> {
    const subs = await Promise.all(
        (
            await fs.promises.readdir(dir)
        )
            .filter((sub) => !sub.startsWith('.'))
            .map((sub) => path.join(dir, sub))
            .map(async (sub) => ({ sub, stat: await pLimit(() => fs.promises.stat(sub)) }))
    )
    const handlers: string[] = []
    const index = subs.find((s) => s.sub.endsWith(`${path.sep}index.ts`))
    if (index !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-var-requires
        if (Object.keys(require(index.sub)).includes('handler')) {
            handlers.push(dir)
        }
    }
    for (const sub of subs.filter((s) => s.stat.isDirectory())) {
        handlers.push(...(await listLambdaHandlers(sub.sub)))
    }

    return handlers
}
