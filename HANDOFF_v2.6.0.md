# v2.6.0 WebCodecs 重构 — 实施计划

## 背景

v2.5.4 通过三层缓存把 1440p 长视频的崩溃问题压住了，但**没解决根本矛盾**：解码后的 RGBA 帧（14 MB / 帧 @1440p）物理上无法全部放进浏览器内存，导致远端 scrub 必须回后端拉，体验天花板锁死在 "注意力区 ±80 秒流畅 / 远端 200ms 等待"。

**v2.6.0 的目标**：换一条路，让前端 display 层达到 video-player-grade 体验——任意位置 scrub 流畅，内存恒定 ~200 MB，与视频时长/分辨率解耦。

## 核心架构变化

### 当前 (v2.5.x)
```
后端: mp4 → FFmpeg → 15094 个 JPEG 文件
前端: HTTP 拉 JPEG → <Image> 解码 → RGBA 缓存 → drawImage
```
单帧前端持有 14 MB RGBA。15094 帧 × 14 MB = 211 GB（不可能）。

### 目标 (v2.6.0)
```
后端: mp4 静态文件 (HTTP Range)              ← 新增
       FFmpeg → JPEG 文件 (推理用,不变)       ← 保留
前端: mp4box.js demux → H.264 chunks → VideoDecoder (GPU)
       → VideoFrame → drawImage → close()
```
单帧持有 ~5.5 MB YUV (硬解临时)。任意时长视频内存恒定 ~200 MB。

**关键认知**：video player 内存恒定不是因为缓存得多，是因为**用过即弃**——硬件解码快到不需要缓存。

## 范围（必做）

### Phase 1 · Backend mp4 streaming (0.5 day)

**目标**：让前端能通过 HTTP Range 流式读 mp4。

- [ ] 新增 `GET /video-stream/{session_id}` 路由
- [ ] FastAPI `FileResponse` 已自动处理 Range，无需手写
- [ ] CORS 头、`Accept-Ranges: bytes`
- [ ] 测试：`curl -r 0-1023` 拿到首 1KB

**文件**：`backend/app/api/routes.py`、`backend/app/services/frame_extraction.py`（已经持有 mp4 路径）。

### Phase 2 · Frontend mp4 demux (1 day)

**目标**：把 mp4 拆成 H.264 chunks，建立 timestamp ↔ frame index 映射。

- [ ] 安装 `mp4box.js`（~200 KB lib，成熟方案）
- [ ] `VideoDemuxer` 类：streaming 读 mp4，emit chunks
- [ ] codec config 抽取（avcC box）
- [ ] timestamp ↔ frame index map（标注按帧号存，必须精确）

**新文件**：`src/services/VideoDemuxer.ts`。

### Phase 3 · WebCodecs decode pipeline (1-2 days)

**目标**：替换 `FramePlayer` 的 `loadFrameImage` 实现。

- [ ] `VideoDecoder` 初始化（H.264 配置）
- [ ] `decode(chunk)` → `output: VideoFrame`
- [ ] keyframe-aware seek：找前一个 IDR 帧，decode 到目标
- [ ] LRU 缓存 ~50 个 VideoFrame（5.5 MB × 50 = 275 MB）
- [ ] `videoFrame.close()` 在 RGBA evict 时同步

**文件**：`src/views/EditorView/FramePlayer/FramePlayer.tsx`。`videoFrameFiles` / JPEG cache 改成可选路径，仅在 fallback 模式启用。

### Phase 4 · Annotation integration (0.5 day)

**目标**：让标注 / 推理 / SAM 都能拿到当前帧。

- [ ] `EditorModel.videoFrameImage` 改成 `VideoFrame | HTMLImageElement`（联合类型）
- [ ] `DetectionAPIDetector.ts:296,314`、`AIDetectionActions.ts:772`：`drawImage` 第一参支持 `VideoFrame`（已经是 `CanvasImageSource`）
- [ ] `SmartAnnotationActions.ts` 的 `resolveImageBlob`：从 VideoFrame 走 `OffscreenCanvas → toBlob`
- [ ] 渲染层（`PrimaryEditorRenderEngine` 等）：标注绘制完全不动

**风险评估**：标注 / 推理逻辑改动 ~5 行。

### Phase 5 · Browser fallback (1 day)

**目标**：WebCodecs 不支持 / 编码不支持时，无缝退回 v2.5.x JPEG 路径。

- [ ] `VideoDecoder.isConfigSupported({codec})` 探测
- [ ] Safari < 16.4 / Firefox 旧版：feature detect → JPEG 路径
- [ ] H.265 / VP9 / AV1：探测失败 → JPEG 路径 + 提示
- [ ] 用户友好提示："当前浏览器/编码使用兼容模式，建议升级"

### Phase 6 · Testing & polish (1-2 days)

- [ ] H.264 baseline / main / high profile
- [ ] H.265, VP9, AV1（探测 + fallback）
- [ ] 1080p / 1440p / 4K
- [ ] 短视频（<1min）/ 长视频（>30min）
- [ ] 损坏 / 不规范 mp4 容错
- [ ] 内存基准：Chrome DevTools Memory tab，对比 v2.5.4
- [ ] scrub 体验对比：录屏 v2.5.4 vs v2.6.0

## 非目标（明确不做）

- ❌ Redux `imagesData` 标准化（O(N²) → O(N)）—— 留给 v2.7.0
- ❌ `/segment-session` 流式接口 —— 留给 v2.7.0
- ❌ 后端推理路径改造 —— 后端继续用预拆 JPEG 跑推理
- ❌ 重写标注 / 渲染层 —— 完全保留
- ❌ 多 tier 主动预加载 —— 用过即弃模式不需要

## 成功指标

| 指标 | v2.5.4 现状 | v2.6.0 目标 |
|---|---|---|
| 1440p 10min 视频内存峰值 | ~1.5 GB | **≤ 300 MB** |
| 任意位置 scrub 延迟 | 远端 ~200ms (后端拉) | **≤ 100ms** |
| 4K / 1 小时视频 | 不可用 | **可用** |
| 标注 / 推理 / 跟踪 | 100% | **100%** |

## 关键风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| 用户视频是 H.265 / 古怪编码 | 中 | Phase 5 fallback |
| Safari / 旧浏览器 | 中 | Phase 5 fallback |
| keyframe seek 精度问题 | 低 | mp4box.js 处理 |
| HDR / 10-bit 视频 | 低 | 探测后 fallback |
| 后端 mp4 静态文件大流量 | 低 | Range 请求按需读 |

## 工程量估计

**5-7 工作日**（一人）。可分两个迭代：
- 迭代 1（Phase 1-3）：核心可跑，~3-4 天
- 迭代 2（Phase 4-6）：集成 + fallback + 测试，~2-3 天

## 参考资料

- [WebCodecs API spec](https://w3c.github.io/webcodecs/)
- [mp4box.js docs](https://github.com/gpac/mp4box.js)
- [Chrome WebCodecs samples](https://github.com/w3c/webcodecs/tree/main/samples)
- 浏览器兼容：Chrome 94+, Edge 94+, Safari 16.4+, Firefox 130+

## 决策日志

- 2026-05-07：初版计划，确认走 WebCodecs + 保留后端 JPEG 推理路径的"双轨"架构
