import {completeTerminalCommand, terminalCompletionCandidates} from '../ComputeTerminalPanel';

describe('completeTerminalCommand', () => {
    it('completes platform commands and names already visible in terminal output', () => {
        expect(completeTerminalCommand('di', 'windows', '')).toBe('dir');
        expect(completeTerminalCommand('una', 'linux', '')).toBe('uname');
        expect(completeTerminalCommand('cd Des', 'windows', '<DIR> Desktop')).toBe('cd Desktop');
    });

    it('shows platform-aware command and path candidates', () => {
        expect(terminalCompletionCandidates('cl', 'linux', '')).toEqual(['clear']);
        expect(terminalCompletionCandidates('cl', 'windows', '')).toEqual(['cls']);
        expect(terminalCompletionCandidates('cd model-', 'linux', 'model-a model-b')).toEqual([
            'cd model-a',
            'cd model-b',
        ]);
    });

    it('accepts the first full candidate as the inline completion', () => {
        expect(completeTerminalCommand('cd model-', 'linux', 'model-a model-b')).toBe('cd model-a');
    });
});
