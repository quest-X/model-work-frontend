/**
 * VideoDemuxer — mp4 → H.264/H.265 EncodedVideoChunk 流
 *
 * v2.6.0 WebCodecs 路径的核心服务。从后端 mp4 流式 Range 读取,
 * 用 mp4box.js 解析 sample 表,按需取出帧的编码 chunks 喂给 VideoDecoder。
 *
 * 工作流程:
 *   1. create(url) → 用 Range 抓 mp4 头,解析 moov box,得到所有 sample 的
 *      (offset, size, timestamp, keyframe) 元数据。
 *   2. getChunksForFrame(idx) → 找前一个 keyframe,Range 抓 [keyframe..idx]
 *      的字节,切成 per-sample 的 EncodedVideoChunk 数组。
 *
 * 兼容性: H.264 (avc1) 普遍支持。H.265/VP9/AV1 由 VideoDecoder.isConfigSupported
 * 探测,Phase 5 fallback 到 v2.5.x JPEG 路径。
 */

import MP4Box, { type MP4ArrayBuffer, type ISOFile, type MP4Sample, type MP4Info } from 'mp4box';

export interface DemuxerInfo {
    codec: string;            // e.g. 'avc1.640028',传给 VideoDecoder.configure
    width: number;
    height: number;
    fps: number;
    totalFrames: number;
    duration: number;         // seconds
    description: Uint8Array;  // codec config (avcC/hvcC box content)
    timescale: number;        // mp4 时间基 (通常 90000 或 fps × N)
}

interface SampleEntry {
    offset: number;       // byte offset in mp4 file
    size: number;         // sample byte size
    timestamp: number;    // μs (microseconds, WebCodecs 单位)
    duration: number;     // μs
    isKeyframe: boolean;
}

const HEADER_FETCH_BYTES = 4 * 1024 * 1024; // 抓前 4MB 找 moov,普通 mp4 够用

export class VideoDemuxer {
    private url: string;
    private info!: DemuxerInfo;
    private samples!: SampleEntry[]; // 按时间排序,索引 = frame index
    private trackId!: number;
    private fileSize: number = 0;

    private constructor(url: string) {
        this.url = url;
    }

    static async create(url: string): Promise<VideoDemuxer> {
        const demuxer = new VideoDemuxer(url);
        await demuxer.parseHeader();
        return demuxer;
    }

    getInfo(): DemuxerInfo {
        return this.info;
    }

    /** 取出解码 frameIdx 所需的 chunks (含前一个 keyframe 到 frameIdx)。 */
    async getChunksForFrame(frameIdx: number): Promise<EncodedVideoChunk[]> {
        if (frameIdx < 0 || frameIdx >= this.samples.length) {
            throw new Error(`Frame ${frameIdx} out of range [0, ${this.samples.length})`);
        }
        // 1. 向前找 keyframe
        let kfIdx = frameIdx;
        while (kfIdx > 0 && !this.samples[kfIdx].isKeyframe) {
            kfIdx--;
        }
        // 2. Range 抓 [kfIdx..frameIdx] 的字节
        const startByte = this.samples[kfIdx].offset;
        const endSample = this.samples[frameIdx];
        const endByte = endSample.offset + endSample.size - 1;
        const bytes = await this.fetchRange(startByte, endByte);
        // 3. 切成 per-sample chunks
        const chunks: EncodedVideoChunk[] = [];
        for (let i = kfIdx; i <= frameIdx; i++) {
            const s = this.samples[i];
            const sliceStart = s.offset - startByte;
            const sliceEnd = sliceStart + s.size;
            const data = bytes.slice(sliceStart, sliceEnd);
            chunks.push(new EncodedVideoChunk({
                type: s.isKeyframe ? 'key' : 'delta',
                timestamp: s.timestamp,
                duration: s.duration,
                data,
            }));
        }
        return chunks;
    }

    /** 帧号 → μs */
    frameToTimestamp(frameIdx: number): number {
        return this.samples[frameIdx]?.timestamp ?? 0;
    }

    /** μs → 最近的帧号 (二分) */
    timestampToFrame(timestampUs: number): number {
        let lo = 0, hi = this.samples.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.samples[mid].timestamp < timestampUs) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    // ===== 内部 =====

    private async parseHeader(): Promise<void> {
        // 先 HEAD 拿文件大小 (Content-Length 即总字节)
        const headRes = await fetch(this.url, { method: 'HEAD' });
        if (!headRes.ok) throw new Error(`HEAD ${this.url} failed: ${headRes.status}`);
        const lenHeader = headRes.headers.get('content-length');
        if (!lenHeader) throw new Error('Missing Content-Length on mp4 stream');
        this.fileSize = parseInt(lenHeader, 10);

        // 抓前 N MB 找 moov。多数 mp4 把 moov 放头部,faststart-mp4 一定如此。
        const file = MP4Box.createFile() as ISOFile;
        let info: MP4Info | null = null;
        let samples: MP4Sample[] = [];

        return new Promise<void>(async (resolve, reject) => {
            file.onError = (err: string) => reject(new Error(`mp4box parse error: ${err}`));
            file.onReady = (mp4info: MP4Info) => {
                info = mp4info;
                const videoTrack = mp4info.videoTracks[0];
                if (!videoTrack) {
                    reject(new Error('mp4 没有视频轨'));
                    return;
                }
                this.trackId = videoTrack.id;
                file.setExtractionOptions(videoTrack.id, null, { nbSamples: 1_000_000 });
                file.start();
            };
            file.onSamples = (_id: number, _user: unknown, parsedSamples: MP4Sample[]) => {
                samples.push(...parsedSamples);
            };

            // 拉头部 chunk
            try {
                let cursor = 0;
                const tryRange = async (size: number): Promise<boolean> => {
                    const end = Math.min(cursor + size - 1, this.fileSize - 1);
                    const bytes = await this.fetchRange(cursor, end);
                    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as MP4ArrayBuffer;
                    buf.fileStart = cursor;
                    file.appendBuffer(buf);
                    cursor = end + 1;
                    return info !== null && samples.length > 0;
                };

                // 尝试 4MB,8MB,32MB; 大多数视频前 4MB 已含 moov
                if (!(await tryRange(HEADER_FETCH_BYTES))) {
                    if (!(await tryRange(HEADER_FETCH_BYTES * 2))) {
                        // moov 可能在尾部,抓最后 16MB
                        const tailStart = Math.max(0, this.fileSize - 16 * 1024 * 1024);
                        const tailBytes = await this.fetchRange(tailStart, this.fileSize - 1);
                        const tailBuf = tailBytes.buffer.slice(tailBytes.byteOffset, tailBytes.byteOffset + tailBytes.byteLength) as MP4ArrayBuffer;
                        tailBuf.fileStart = tailStart;
                        file.appendBuffer(tailBuf);
                    }
                }
                file.flush();

                if (!info) {
                    reject(new Error('mp4 解析失败:未找到 moov box'));
                    return;
                }
                if (samples.length === 0) {
                    reject(new Error('mp4 解析失败:未拿到 sample 数据'));
                    return;
                }

                // 提取 codec config (avcC/hvcC box → description)
                const videoTrack = info.videoTracks[0];
                const description = this.extractDescription(file, videoTrack.id);

                // 把 mp4box 时间戳 (cts/ticks) 换成 μs,构造 SampleEntry 表
                const timescale = videoTrack.timescale;
                this.samples = samples.map(s => ({
                    offset: s.offset,
                    size: s.size,
                    timestamp: Math.round((s.cts / timescale) * 1_000_000),
                    duration: Math.round((s.duration / timescale) * 1_000_000),
                    isKeyframe: s.is_sync,
                }));

                this.info = {
                    codec: videoTrack.codec,
                    width: videoTrack.video.width,
                    height: videoTrack.video.height,
                    fps: videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale),
                    totalFrames: this.samples.length,
                    duration: videoTrack.duration / videoTrack.timescale,
                    description,
                    timescale,
                };
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * 从 mp4box 已解析的 trak 里提取 avcC/hvcC box 的二进制内容,
     * 这就是 VideoDecoder.configure({ description }) 需要的 codec config。
     */
    private extractDescription(file: ISOFile, trackId: number): Uint8Array {
        const track = (file as any).getTrackById(trackId);
        const entry = track?.mdia?.minf?.stbl?.stsd?.entries?.[0];
        if (!entry) throw new Error('mp4 解析失败:未找到 sample entry');
        // H.264 用 avcC,H.265 用 hvcC
        const box = entry.avcC || entry.hvcC || entry.av1C || entry.vpcC;
        if (!box) throw new Error(`未识别的 codec config box: ${entry.type}`);
        // mp4box 内置 DataStream 用于序列化
        const DataStream = (MP4Box as any).DataStream;
        const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
        box.write(stream);
        // box 写出来包含 8 字节的 box header (size + type),要去掉
        const buf = new Uint8Array(stream.buffer);
        return buf.slice(8);
    }

    private async fetchRange(startByte: number, endByte: number): Promise<Uint8Array> {
        const res = await fetch(this.url, {
            headers: { Range: `bytes=${startByte}-${endByte}` },
        });
        if (!res.ok && res.status !== 206 && res.status !== 200) {
            throw new Error(`Range ${startByte}-${endByte} failed: ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
    }
}
