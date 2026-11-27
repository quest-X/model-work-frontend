export class Terminal {
    static instances: Terminal[] = [];
    rows = 24;
    cols = 80;
    element?: HTMLDivElement;
    private dataListener?: (data: string) => void;
    private resizeListener?: (size: {rows: number; cols: number}) => void;

    constructor(_options?: unknown) {
        Terminal.instances.push(this);
    }

    loadAddon(_addon: unknown): void {}

    open(container: HTMLElement): void {
        this.element = document.createElement('div');
        this.element.className = 'xterm';
        this.element.tabIndex = 0;
        container.appendChild(this.element);
    }

    write(data: string): void {
        if (this.element) this.element.textContent += data;
    }

    writeln(data: string): void { this.write(`${data}\n`); }
    reset(): void { if (this.element) this.element.textContent = ''; }
    focus(): void { this.element?.focus(); }
    dispose(): void { this.element?.remove(); }

    onData(listener: (data: string) => void): {dispose: () => void} {
        this.dataListener = listener;
        return {dispose: () => { this.dataListener = undefined; }};
    }

    onResize(listener: (size: {rows: number; cols: number}) => void): {dispose: () => void} {
        this.resizeListener = listener;
        return {dispose: () => { this.resizeListener = undefined; }};
    }

    emitData(data: string): void { this.dataListener?.(data); }
    emitResize(rows: number, cols: number): void { this.resizeListener?.({rows, cols}); }
}
