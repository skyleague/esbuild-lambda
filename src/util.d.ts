declare module 'deterministic-zip' {
    export default function zip(
        source: string,
        target: string,
        options: { includes: string[]; exclude: string[]; cwd: string },
    ): Promise<void>
}
