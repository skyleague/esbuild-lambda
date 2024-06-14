import { spawn } from 'node:child_process'

export async function spawnAsync(...args: Parameters<typeof spawn>) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(...args)
        child.on('error', reject)
        child.on('exit', (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(`Process exited with code ${code}`))
            }
        })
    })
}
