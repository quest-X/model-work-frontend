export class ImageLoadManager {

	private static queue: (() => Promise<void>)[] = [];
	private static isRunning: boolean = false;

	public static add(fx: Promise<void>) {
		ImageLoadManager.queue.push(async () => await fx);
	}

	public static run() {
		setTimeout(() => ImageLoadManager.runQueue(), 10);
	}

	public static addAndRun(fx: Promise<void>) {
		ImageLoadManager.add(fx);
		ImageLoadManager.run();
	}

	public static async runQueue() {
		if (!ImageLoadManager.isRunning) {
			ImageLoadManager.isRunning = true;
			await ImageLoadManager.runTasks();
			ImageLoadManager.isRunning = false;
		}
	}

	private static async runTasks() {
		while (ImageLoadManager.queue.length > 0) {
			const fx = ImageLoadManager.queue.shift();
			await fx();
		}
	}
}
