export function requestedImageIndices(imageCount: number): number[] | null {
    const raw = sessionStorage.getItem('opensight.annotation.imageIndices');
    if (raw === null) return null;
    const indices: unknown = JSON.parse(raw);
    if (!Array.isArray(indices) || indices.length === 0 || new Set(indices).size !== indices.length
        || indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= imageCount)) {
        throw new Error('Invalid inference image indices');
    }
    return indices;
}
