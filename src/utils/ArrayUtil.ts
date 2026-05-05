export type PartitionResult<T> = {
    pass: T[]
    fail: T[]
}

export class ArrayUtilAmbiguousMatchError extends Error {
    constructor() {
        super('Given predicate results in more than one value being matched.');
        this.name = 'ArrayUtilAmbiguousMatchError';
    }
}

export class EmptyArrayError extends Error {
    constructor() {
        super('Given array is empty.');
        this.name = 'EmptyArrayError';
    }
}

export class NegativeIndexError extends Error {
    constructor() {
        super('Index can not be negative.');
        this.name = 'NegativeIndexError';
    }
}

export class ArrayUtil {
    public static partition<T>(array: T[], predicate: (T) => boolean): PartitionResult<T> {
        return array.reduce((acc: PartitionResult<T>, item: T) => {
            if (predicate(item))
                acc.pass.push(item)
            else
                acc.fail.push(item)
            return acc
        }, {pass: [], fail: []})
    }

    public static match<T, P>(array1: T[], array2: P[], predicate: (key: T, value: P) => boolean): [T, P][] {
        return array1.reduce((acc: [T, P][], key: T) => {
            const match = array2.filter((value: P) => predicate(key, value))
            if (match.length === 1) {
                acc.push([key, match[0]])
            } else if (match.length > 1) {
                throw new ArrayUtilAmbiguousMatchError()
            }
            return acc
        }, [])
    }

    public static unzip<T, P>(array: [T, P][]): [T[], P[]] {
        return array.reduce((acc: [T[], P[]], i: [T, P]) => {
            acc[0].push(i[0]);
            acc[1].push(i[1]);
            return acc;
        }, [[], []])
    }

    public static getByInfiniteIndex<T>(array: T[], index: number): T {
        if (array.length === 0) {
            throw new EmptyArrayError()
        }
        if (index < 0) {
            throw new NegativeIndexError()
        }
        const boundedIndex: number = index % array.length
        return array[boundedIndex]
    }

    /**
     * Split an array into consecutive sub-arrays of size `size`.
     * The last chunk may be smaller. A non-positive size yields a single
     * chunk containing the whole input (defensive against bad callers).
     */
    public static chunk<T>(items: T[], size: number): T[][] {
        if (!Array.isArray(items) || items.length === 0) return [];
        if (!Number.isFinite(size) || size <= 0) return [items.slice()];
        const out: T[][] = [];
        for (let i = 0; i < items.length; i += size) {
            out.push(items.slice(i, i + size));
        }
        return out;
    }
}
