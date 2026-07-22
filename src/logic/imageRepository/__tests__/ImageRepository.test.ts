import {ImageRepository} from '../ImageRepository';
import {ImageData} from '../../../store/labels/types';

const imageWithSource = (source: string): HTMLImageElement => {
    const image = new Image();
    image.src = source;
    return image;
};

describe('ImageRepository file cache', () => {
    beforeEach(() => {
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: jest.fn(),
        });
        ImageRepository.clearAllCache();
    });

    afterEach(() => {
        ImageRepository.clearAllCache();
        ImageRepository.setLiveImageCap(300);
    });

    it('does not restore an image whose blob source was cleared by LRU eviction', () => {
        ImageRepository.setLiveImageCap(1);
        const evicted = imageWithSource('blob:evicted');
        ImageRepository.storeImage('frame-1', evicted);
        ImageRepository.saveFileCache('video-a', [{id: 'frame-1'} as ImageData]);

        ImageRepository.storeImage('frame-2', imageWithSource('blob:current'));
        expect(evicted.getAttribute('src')).toBe('');

        ImageRepository.clearCurrentDisplay();
        ImageRepository.restoreFileCache('video-a');

        expect(ImageRepository.getById('frame-1')).toBeUndefined();
        expect(ImageRepository.getCacheStats().currentImageCount).toBe(0);
    });

    it('treats an empty-src repository entry as a cache miss', () => {
        const stale = imageWithSource('blob:stale');
        ImageRepository.storeImage('frame-1', stale);
        stale.src = '';

        expect(ImageRepository.getById('frame-1')).toBeUndefined();
        expect(ImageRepository.getCacheStats().currentImageCount).toBe(0);
    });
});
