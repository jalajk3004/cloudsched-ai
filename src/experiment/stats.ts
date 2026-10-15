// Two-sided 95% t critical values for df = 1..30; 1.96 beyond.
const T95 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160,
    2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];

export interface PairedStats {
    n: number; meanDiff: number; ciLow: number; ciHigh: number;
    wins: number; ties: number; losses: number; signP: number;
}

export function signTest(w: number, l: number): number {          // exact two-sided
    const n = w + l;
    if (n === 0) return 1;
    const coef: number[] = [1];
    for (let i = 1; i <= n; i++) coef.push((coef[i - 1] * (n - i + 1)) / i);
    let tail = 0;
    for (let i = Math.max(w, l); i <= n; i++) tail += coef[i];
    return Math.min(1, (2 * tail) / 2 ** n);
}

/** a = system under test, b = reference, one entry per paired seed. diff = a - b. */
export function pairedStats(a: number[], b: number[], lowerIsBetter: boolean, tol = 1e-9): PairedStats {
    const n = a.length;
    const diffs = a.map((x, i) => x - b[i]);
    const mean = diffs.reduce((s, d) => s + d, 0) / n;
    const sd = n > 1 ? Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1)) : NaN;
    const half = (n > 1 ? (n - 1 <= 30 ? T95[n - 1] : 1.96) : NaN) * (sd / Math.sqrt(n));
    let wins = 0, ties = 0, losses = 0;
    for (const d of diffs) {
        if (Math.abs(d) <= tol) ties++;
        else if (lowerIsBetter ? d < 0 : d > 0) wins++;
        else losses++;
    }
    return { n, meanDiff: mean, ciLow: mean - half, ciHigh: mean + half, wins, ties, losses, signP: signTest(wins, losses) };
}

export function formatPaired(s: PairedStats, digits = 2): string {
    const sign = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(digits);
    return `diff ${sign(s.meanDiff)} [95% CI ${sign(s.ciLow)}, ${sign(s.ciHigh)}] | ${s.wins}W/${s.ties}T/${s.losses}L p=${s.signP.toFixed(3)}`;
}