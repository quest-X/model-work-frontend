import {completeTerminalCommand} from '../ComputeTerminalPanel';

describe('completeTerminalCommand', () => {
    it('completes platform commands and names already visible in terminal output', () => {
        expect(completeTerminalCommand('di', 'windows', '')).toBe('dir');
        expect(completeTerminalCommand('una', 'linux', '')).toBe('uname');
        expect(completeTerminalCommand('cd Des', 'windows', '<DIR> Desktop')).toBe('cd Desktop');
    });
});
