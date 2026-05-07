/**
 * 本地最小类型声明,绕开 mp4box.js 自带 d.ts 用了 TS 5.0+ 的 const 类型参数语法,
 * 而本项目当前 TS 4.7.4 无法解析的问题。
 *
 * 升级 TS 是另一项工作;先用最小 stub 解锁 v2.6.0 WebCodecs 推进。
 */
declare module 'mp4box' {
    export interface MP4ArrayBuffer extends ArrayBuffer {
        fileStart: number;
    }

    export interface MP4VideoTrack {
        id: number;
        codec: string;
        timescale: number;
        duration: number;
        nb_samples: number;
        video: { width: number; height: number };
    }

    export interface MP4Info {
        videoTracks: MP4VideoTrack[];
        audioTracks: any[];
        duration: number;
        timescale: number;
    }

    export interface MP4Sample {
        offset: number;
        size: number;
        cts: number;        // composition timestamp (ticks)
        dts: number;        // decode timestamp
        duration: number;   // ticks
        is_sync: boolean;
        track_id: number;
    }

    export interface ISOFile {
        onReady: (info: MP4Info) => void;
        onSamples: (id: number, user: unknown, samples: MP4Sample[]) => void;
        onError: (err: string) => void;
        appendBuffer: (buf: MP4ArrayBuffer) => number;
        setExtractionOptions: (trackId: number, user: unknown, opts: { nbSamples?: number; rapAlignement?: boolean }) => void;
        start: () => void;
        flush: () => void;
        getTrackById: (id: number) => any;
    }

    export function createFile(): ISOFile;

    export class DataStream {
        static BIG_ENDIAN: number;
        static LITTLE_ENDIAN: number;
        constructor(buffer?: ArrayBuffer, byteOffset?: number, endianness?: number);
        buffer: ArrayBuffer;
    }

    const _default: {
        createFile: typeof createFile;
        DataStream: typeof DataStream;
    };
    export default _default;
}
