import {
    normalizeHostSystem,
    showsTensorRTPlaceholder,
    supportsCoreML,
} from '../HostSystem';

describe('host system model-format gating', () => {
    it.each([
        ['macOS', 'macos'],
        ['Darwin', 'macos'],
        ['MacIntel', 'macos'],
        ['Windows', 'windows'],
        ['Win32', 'windows'],
        ['Linux x86_64', 'linux'],
        ['', 'unknown'],
    ])('normalizes %s to %s', (input, expected) => {
        expect(normalizeHostSystem(input)).toBe(expected);
    });

    it('offers CoreML only on macOS', () => {
        expect(supportsCoreML('macos')).toBe(true);
        expect(supportsCoreML('windows')).toBe(false);
        expect(supportsCoreML('linux')).toBe(false);
    });

    it('keeps the TensorRT placeholder on Windows and Linux only', () => {
        expect(showsTensorRTPlaceholder('windows')).toBe(true);
        expect(showsTensorRTPlaceholder('linux')).toBe(true);
        expect(showsTensorRTPlaceholder('macos')).toBe(false);
        expect(showsTensorRTPlaceholder('unknown')).toBe(false);
    });
});
