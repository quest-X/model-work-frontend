import {FileUtil} from "../FileUtil";

describe('FileUtil readFile', () => {
    afterEach(() => jest.restoreAllMocks());

    it('reads text through the native FileReader', async () => {
        await expect(FileUtil.readFile(new File(['标签\n'], 'labels.txt'))).resolves.toBe('标签\n');
    });

    it('rejects an aborted read instead of resolving null text', async () => {
        const readAsText = FileReader.prototype.readAsText;
        jest.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader, file: Blob) {
            readAsText.call(this, file);
            this.abort();
        });
        await expect(FileUtil.readFile(new File(['label'], 'labels.txt'))).rejects.toMatchObject({name: 'AbortError'});
    });
});

describe('FileUtil extractFileExtension method', () => {
    it('should return file extension', () => {
        // given
        const name: string = "labels.txt";

        // when
        const result = FileUtil.extractFileExtension(name);

        // then
        const expectedResult = "txt";
        expect(result).toEqual(expectedResult);
    });

    it('should return file extension even with multiple dots', () => {
        // given
        const name: string = "custom.file-name.12.labels.txt";

        // when
        const result = FileUtil.extractFileExtension(name);

        // then
        const expectedResult = "txt";
        expect(result).toEqual(expectedResult);
    });

    it('should return null', () => {
        // given
        const name: string = "labels";

        // when
        const result = FileUtil.extractFileExtension(name);

        // then
        const expectedResult = null;
        expect(result).toEqual(expectedResult);
    });
});

describe('FileUtil extractFileName method', () => {
    it('should return file name', () => {
        // given
        const name: string = "labels.txt";

        // when
        const result = FileUtil.extractFileName(name);

        // then
        const expectedResult = "labels";
        expect(result).toEqual(expectedResult);
    });

    it('should return file name even with multiple dots', () => {
        // given
        const name: string = "custom.file-name.12.labels.txt";

        // when
        const result = FileUtil.extractFileName(name);

        // then
        const expectedResult = "custom.file-name.12.labels";
        expect(result).toEqual(expectedResult);
    });
});
