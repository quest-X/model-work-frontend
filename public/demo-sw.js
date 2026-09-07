const FRAMES = [
  '000001', '000016', '000032', '000048', '000064', '000080',
  '000096', '000112', '000128', '000144', '000160', '000174',
];
const BOXES = [
  [1147, 673, 1655, 1215], [1200, 615, 1700, 1135], [1250, 595, 1750, 1095],
  [1270, 560, 1760, 1060], [1240, 540, 1720, 1040], [1200, 520, 1670, 1020],
  [1150, 500, 1600, 1000], [1070, 450, 1500, 980], [1000, 410, 1420, 960],
  [850, 350, 1270, 920], [720, 300, 1170, 880], [700, 180, 1170, 720],
];
const HASHES = [
  '4ed162069b2d9f7b4646d63584e80d4c9f0f32f586f7c1d1019c297f4f502e50',
  'eff9b3c886a26fec7e5b067d08be3f1097997ebe4b6bb41681ad96757885efb1',
  'f3815598d1e49215a8cfb633618f405c5194e4027ff2267416ec113637c2800c',
  'ff487188c32fa9cbd2c5704b5539140059beb8738e5959d4e1079855d138fbab',
  '759f079d10ea643e67d0dc9f00a130fe75a2cda811b7036143b7f538d93c7589',
  'c0fb87941956e14ded9f67a71b245ab43d0951c0ae0e4fb8892bdb148744ff88',
  '9f2bbc204d0b7abf4e1b901f94a88e34780561f5ecb0a40ff58b74437628f15f',
  '486171721af3496d018158dd562957cc56334f792f7a5f41d8a976e77d2cecc3',
  '448a0aa65cfc94f511775f06750da0cf925f3779e55a94b97baecfc3732db834',
  'a470182d98604cdd06468aaf6cb19cd945f10c243eaea538ed5ee1a61beecfb3',
  'b8d8bf7a89b5f6309d2acad64ef60f9a5110a16de916235fedc696e44190c66b',
  'f3873d76f1816eadc09940f48e769f5201d975c7d02b2c367f307f64c66bd9e5',
];
const DEMO_DATASET = {
  id: 'goose-demo',
  name: 'goose_raw · 大鹅演示子集',
  project_name: '大鹅目标检索演示',
  created_at: '2026-08-06T10:40:00Z',
  updated_at: '2026-09-07T00:00:00Z',
  image_count: FRAMES.length,
  annotated_count: FRAMES.length,
  annotation_coverage: 1,
  classes: ['bird'],
  class_distribution: {bird: FRAMES.length},
  format: 'opensight-batch',
  source_type: 'demo_subset',
  source_id: null,
  revision: 1,
  status: 'ready',
  storage_version: 2,
  unique_asset_count: FRAMES.length,
  logical_bytes: 4510000,
  deduplicated_bytes: 0,
  media_type: 'images',
  last_task_at: '2026-09-07T00:00:00Z',
  last_task_type: 'inference',
  versions: [{
    revision: 1,
    operation_type: 'raw',
    operation_name: 'goose_raw 演示快照',
    created_at: '2026-09-07T00:00:00Z',
    parent_revision: null,
    image_count: FRAMES.length,
    annotated_count: FRAMES.length,
  }],
};
const PROFILE = {
  profile_id: 'dinov3-vit-h16plus-cls-1280-demo',
  model: 'DINOv3 ViT-H16+',
  model_revision: 'demo-goose-v1',
  dimension: 1280,
  dim: 1280,
  metric: 'COSINE',
};
const tasks = new Map();

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {'Content-Type': 'application/json; charset=utf-8', 'X-OpenSight-Demo': '1'},
});
const assetUrl = index => `/demo/images/${FRAMES[index]}.webp`;
const session = () => ({
  user: {
    account_id: 'demo-admin',
    username: 'admin',
    display_name: 'OpenSight Platform 演示管理员',
    role: 'admin',
    password_change_required: false,
    avatar_url: null,
    approval: {user_id: 'demo-admin', user_name: 'admin', user_public_key: 'demo-public-key'},
    permissions: ['demo.read', 'demo.inference'],
  },
  csrf_token: 'opensight-demo-csrf',
  expires_at: Math.floor(Date.now() / 1000) + 86400,
});
const model = (id, name, type, size) => ({
  id, name, type, format: 'onnx', size_bytes: size,
  modified_at: '2026-09-07T00:00:00Z', source: 'managed',
  project: 'goose-demo', category: type, path: `/models/demo/${name}`,
  relative_path: `demo/${name}`, callable: true,
});
const models = [
  model('demo:goose-detect', 'goose-detector-demo.onnx', 'detection', 42900000),
  model('demo:goose-segment', 'sam2-goose-demo.onnx', 'segmentation', 168000000),
];
const collection = granularity => ({
  name: `goose_demo_${granularity}`,
  display_name: `goose_raw · ${granularity === 'image' ? '整图' : '目标框'}`,
  dim: 1280,
  embedder: PROFILE.model,
  granularity,
  mode: granularity === 'image' ? 'images' : 'objects',
  count: FRAMES.length,
  search_count: 42,
  created_at: '2026-08-06T10:40:00Z',
  last_ingest_at: '2026-09-07T00:00:00Z',
  schema_version: 2,
  profile_id: PROFILE.profile_id,
  profile: {...PROFILE, granularity},
  library_id: 'goose-demo-library',
  target_id: 'bird',
  target_name: 'bird',
  scene_id: 'lakeside',
  scene_name: '湖边大鹅',
  world_id: 'demo',
  version: 1,
  data_version: 1,
  collection_revision: 1,
  dataset_id: DEMO_DATASET.id,
  dataset_revision: DEMO_DATASET.revision,
  dataset_revisions: {[DEMO_DATASET.id]: DEMO_DATASET.revision},
  active: true,
  index_type: 'FLAT',
  index_params: {metric_type: 'COSINE'},
  compatible: true,
  compatibility_reason: null,
  quality: {valid_vectors: FRAMES.length, invalid_vectors: 0, failed_images: 0, skipped_images: 0},
  branch_kind: 'trunk',
  parent_collection: null,
});

const node = (id, name, platform, architecture, cpu, memoryFree, gpu) => ({
  node_id: id,
  installation_id: `${id}-installation`,
  name,
  role: id === 'demo-main' ? 'main' : 'node',
  agent_version: '0.7.0-demo',
  capabilities: ['system.health.v1'],
  control_transport: 'lan',
  communication_state: 'normal',
  network: {
    provider: 'tailscale', installed: true, online: true, ssh_available: true,
    lan_ssh_available: true, tailscale_ssh_available: true,
    addresses: [`100.64.0.${id === 'demo-main' ? 10 : id === 'demo-gpu' ? 11 : 12}`],
    tailnet: 'opensight-demo', error: null,
  },
  network_dependencies: [
    {dependency_id: 'tailscale', kind: 'overlay_network', state: 'healthy', checked_at: 1, required_for: []},
    {dependency_id: 'control_ssh', kind: 'control_transport', state: 'healthy', checked_at: 1, required_for: []},
  ],
  resources: {
    captured_at: Math.floor(Date.now() / 1000), platform, architecture,
    hardware_model: platform === 'Linux' ? 'NVIDIA Jetson AGX Orin' : null,
    cpu_logical: cpu, cpu_percent: id === 'demo-gpu' ? 43 : 24, load_average_1m: 2.1,
    memory_total_bytes: 32 * 1024 ** 3, memory_available_bytes: memoryFree * 1024 ** 3,
    disk_total_bytes: 1024 ** 4, disk_free_bytes: 620 * 1024 ** 3,
    disk_read_bytes_per_second: 8 * 1024 ** 2, disk_write_bytes_per_second: 2 * 1024 ** 2,
    network_receive_bytes_per_second: 4 * 1024 ** 2, network_send_bytes_per_second: 1024 ** 2,
    gpus: gpu ? [{index: 0, uuid: `${id}-gpu`, name: gpu, memory_total_mb: 24576,
      memory_used_mb: 8192, utilization_percent: 56, temperature_celsius: 63}] : [],
  },
  device_inventory: {state: 'ready', devices: []},
  enrolled_at: Math.floor(Date.now() / 1000) - 86400 * 30,
  last_seen_at: Math.floor(Date.now() / 1000), enabled: true, online: true, heartbeat_age_seconds: 2,
  labels: {region: id === 'demo-edge' ? 'shandong' : 'shanghai',
    region_name: id === 'demo-edge' ? '山东' : '上海'},
});
const NODES = [
  node('demo-main', '上海主控节点', 'Darwin', 'arm64', 12, 18, null),
  node('demo-gpu', '上海推理节点', 'Windows', 'AMD64', 32, 20, 'NVIDIA RTX 4090'),
  node('demo-edge', '山东边缘节点', 'Linux', 'aarch64', 12, 22, 'NVIDIA Jetson AGX Orin'),
];

const visualSearchTask = async request => {
  const form = await request.clone().formData().catch(() => new FormData());
  const kind = ['image', 'bbox'].includes(form.get('query_kind')) ? form.get('query_kind') : 'image';
  const collectionName = String(form.get('collection') || `goose_demo_${kind}`);
  let queryBBox = [0, 0, 1920, 1440];
  if (kind === 'bbox') {
    try { queryBBox = JSON.parse(String(form.get('bbox') || '')); } catch { queryBBox = BOXES[0]; }
  }
  const id = `demo-${kind}-${Date.now()}`;
  const resultIndexes = [1, 2, 3, 4, 5];
  const now = Date.now();
  const task = {
    task_id: id, state: 'succeeded', phase: 'completed', progress: 100,
    created_at: now, started_at: now, updated_at: now, finished_at: now,
    query_kind: kind, query_geometry: {kind, bbox: queryBBox},
    result: {
      collection: collectionName, query_kind: kind, query_geometry: {kind, bbox: queryBBox},
      profile_id: PROFILE.profile_id, model_revision: PROFILE.model_revision,
      collection_revision: 1, executed_stages: ['dinov3'],
      stage_status: {dinov3: 'completed', naf: 'experimental_stage_disabled', sam: 'experimental_stage_disabled'},
      total: resultIndexes.length, elapsed_ms: 38,
      items: resultIndexes.map((index, rank) => {
        const bbox = kind === 'image' ? [0, 0, 1920, 1440] : BOXES[index];
        return {
          result_id: `${id}-${FRAMES[index]}`, asset_id: `sha256:${HASHES[index]}`,
          dataset_id: DEMO_DATASET.id, dataset_revision: 1, rank: rank + 1,
          path: assetUrl(index), filename: `${FRAMES[index]}.webp`, width: 1920, height: 1440,
          class_name: kind === 'bbox' ? 'bird' : null, confidence: 0.98 - rank * 0.02,
          score: 0.98 - rank * 0.02, dino_score: 0.98 - rank * 0.02,
          bbox, thumbnail: assetUrl(index), content_sha256: HASHES[index],
          region_id: kind === 'bbox' ? `bird-${index}` : `image-${index}`, granularity: kind,
          region_source: 'goose_demo', geometry_sha256: `demo-geometry-${index}`,
          acceptance_eligible: kind === 'bbox', acceptance_reason: kind === 'bbox' ? null : 'full_image_preview_only',
          geometry: {kind, bbox},
        };
      }),
    },
  };
  tasks.set(id, task);
  return task;
};

const graph = () => {
  const regions = [['shanghai', '上海', 2], ['shandong', '山东', 1]];
  const entities = [
    {entity_id: 'group:demo', kind: 'compute_group', label: 'OpenSight Platform 演示集群', state: 'available', callable: true,
      modes: [], member_count: 3, online_member_count: 3},
    ...regions.map(([id, label, count]) => ({entity_id: `region:${id}`, kind: 'compute_region', label,
      state: 'available', callable: true, modes: [], region_id: id, region_name: label,
      member_count: count, online_member_count: count})),
    ...NODES.map(item => ({entity_id: `node:${item.node_id}`, kind: 'compute_node', label: item.name,
      state: 'available', callable: true, modes: [], node_id: item.node_id,
      region_id: item.labels.region, region_name: item.labels.region_name,
      platform: item.resources.platform, architecture: item.resources.architecture,
      cpu_logical: item.resources.cpu_logical, memory_available_bytes: item.resources.memory_available_bytes,
      disk_free_bytes: item.resources.disk_free_bytes, gpu_count: item.resources.gpus.length})),
  ];
  const relations = [
    ...regions.map(([id]) => ({relation_id: `group-region-${id}`, kind: 'contains', source_id: 'group:demo',
      target_id: `region:${id}`, active: true, reason: 'available'})),
    ...NODES.map(item => ({relation_id: `region-node-${item.node_id}`, kind: 'contains',
      source_id: `region:${item.labels.region}`, target_id: `node:${item.node_id}`, active: true, reason: 'available'})),
  ];
  return {schema_version: 'resource-knowledge-graph.v3', group_id: 'demo',
    generated_at: Math.floor(Date.now() / 1000), summary: {entities: entities.length, relations: relations.length,
      online_nodes: 3, regions: 2, compute_resources: 3, managed_devices: 0,
      network_dependencies: 0, healthy_network_dependencies: 0, work_agents: 0,
      callable_work_agents: 0, interactive_work_agents: 0}, entities, relations};
};

const matchDemoRoute = pathname => pathname.startsWith('/core_service/')
  ? 'core'
  : pathname.startsWith('/extension_service/') ? 'extension' : null;

const handleDemoRequest = async request => {
  const url = new URL(request.url);
  const {pathname} = url;
  const method = request.method.toUpperCase();

  if (pathname === '/core_service/account/login' && method === 'POST') {
    const body = await request.clone().json().catch(() => ({}));
    return body.username === 'admin' && body.password === 'admin'
      ? json(session())
      : json({detail: '演示账号或密码错误'}, 401);
  }
  if (pathname === '/core_service/account/session') return json(session());
  if (pathname === '/core_service/account/logout' && method === 'POST') return new Response(null, {status: 204});

  if (pathname === '/core_service/health') return json({
    status: 'ok', engine: {type: 'core', name: 'OpenSight Platform Demo Core', api_version: '1',
      base_path: '/core_service', capabilities: ['detection', 'segmentation', 'datasets']},
    model: models[0].name, model_asset_id: models[0].id, model_type: 'detection',
    segmentation_model: models[1].name, segmentation_model_asset_id: models[1].id,
    segmentation_model_type: 'segmentation', loaded_models: models.map(item => item.name),
    model_tasks: {[models[0].name]: 'detect', [models[1].name]: 'segment'},
    services: {detection: 'ready', segmentation: 'ready', datasets: 'ready'},
    resources: {cpu_percent: 31, ram_used_gb: 11.4, ram_total_gb: 32, gpu_percent: 56},
  });
  if (pathname === '/core_service/available-models') return json({models});
  if (pathname === '/core_service/switch-model' && method === 'POST') {
    const body = await request.clone().json().catch(() => ({}));
    const selected = models.find(item => item.id === body.model || item.name === body.model) || models[0];
    return json({status: 'success', active: selected.name, model_asset_id: selected.id});
  }
  if (pathname === '/core_service/datasets') return json({datasets: [DEMO_DATASET]});
  if (pathname === `/core_service/datasets/${DEMO_DATASET.id}`) return json(DEMO_DATASET);
  if (pathname === `/core_service/datasets/${DEMO_DATASET.id}/stats`) return json({
    image_count: FRAMES.length, class_distribution: {bird: FRAMES.length},
    annotated_count: FRAMES.length, annotation_coverage: 1,
  });
  if (pathname === `/core_service/datasets/${DEMO_DATASET.id}/preview`) {
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const limit = Math.max(1, Number(url.searchParams.get('limit')) || 12);
    return json({total: FRAMES.length, offset, limit,
      items: FRAMES.slice(offset, offset + limit).map((frame, index) => ({index: offset + index, name: `${frame}.webp`}))});
  }
  const preview = pathname.match(/^\/core_service\/datasets\/goose-demo\/preview\/(\d+)\/(?:thumbnail|original)$/);
  if (preview) {
    const index = Number(preview[1]);
    return index >= 0 && index < FRAMES.length ? fetch(assetUrl(index)) : json({detail: 'image not found'}, 404);
  }
  if (pathname === `/core_service/datasets/${DEMO_DATASET.id}/export`) return fetch('/demo/goose-workspace.zip');
  if (pathname === '/core_service/detect' && method === 'POST') return json({
    status: 'success', total: 1, results: [{info: {id: 0, name: 'bird', confidence: 0.97}, bbox: BOXES[0]}],
  });
  if (pathname === '/core_service/batch_detect' && method === 'POST') {
    const form = await request.clone().formData().catch(() => new FormData());
    const count = Math.max(1, form.getAll('images').length);
    return json({status: 'success', results: Array.from({length: count}, (_, index) => [
      {info: {id: 0, name: 'bird', confidence: 0.97}, bbox: BOXES[index % BOXES.length]},
    ])});
  }
  if (pathname === '/core_service/segment' && method === 'POST') return json({
    status: 'success', total: 1, results: [{info: {id: 0, name: 'bird', confidence: 0.96},
      bbox: BOXES[0], mask: [[1147, 760], [1210, 690], [1390, 675], [1570, 790], [1655, 1080],
        [1510, 1215], [1260, 1160], [1150, 980]]}],
  });

  if (pathname === '/extension_service/health') return json({
    status: 'ok', engine: {type: 'extension', name: 'OpenSight Platform Demo Extension', api_version: '1',
      base_path: '/extension_service', capabilities: ['vector_db', 'compute_cluster']},
    services: {vector_db: 'ready', compute_cluster: 'ready'},
  });
  if (pathname === '/extension_service/extensions/camera-connect/resources') return json({resources: []});
  if (pathname === '/extension_service/vector_db/status') return json({
    status: 'ok', vector_store: {state: 'ready', db_path: 'demo://goose', error: null},
    embedder: {state: 'ready', progress: 100, backend: 'demo', model: PROFILE.model,
      dim: PROFILE.dimension, device: 'GPU', error: null}, collections_count: 2,
    profiles: {image: {...PROFILE, granularity: 'image'}, bbox: {...PROFILE, granularity: 'bbox'}},
  });
  if (pathname === '/extension_service/vector_db/collections') return json({
    collections: [collection('image'), collection('bbox')],
  });
  if (pathname === '/extension_service/vector_db/search' && method === 'POST') {
    const form = await request.clone().formData().catch(() => new FormData());
    const collectionName = String(form.get('collection') || 'goose_demo_image');
    const isBBox = collectionName.endsWith('_bbox');
    const topK = Math.min(FRAMES.length, Math.max(1, Number(form.get('top_k')) || 5));
    return json({status: 'success', collection: collectionName,
      results: Array.from({length: topK}, (_, rank) => {
        const index = (rank + 1) % FRAMES.length;
        return {score: 0.98 - rank * 0.02, filename: `${FRAMES[index]}.webp`,
          class_name: isBBox ? 'bird' : '', thumbnail: assetUrl(index)};
      })});
  }
  if (pathname === '/extension_service/vector_db/jobs') return json({jobs: [{
    job_id: 'demo-goose-ingest', state: 'completed', data_version: 1, collection: 'goose_demo_image',
    granularity: 'image', mode: 'images', source: 'dataset', dataset_id: DEMO_DATASET.id,
    total_images: FRAMES.length, processed_images: FRAMES.length, inserted_objects: 0,
    inserted_vectors: FRAMES.length, skipped_images: 0, failed_images: 0, invalid_vectors: 0,
    throughput_images_per_sec: 8.6, eta_seconds: null, resumable: false, error: null,
    started_at: '2026-09-07T00:00:00Z', updated_at: '2026-09-07T00:00:02Z', finished_at: '2026-09-07T00:00:02Z',
  }]});
  const jobImages = pathname.match(/^\/extension_service\/vector_db\/jobs\/demo-goose-ingest\/images$/);
  if (jobImages) return json({status: 'ok', job_id: 'demo-goose-ingest', total: FRAMES.length,
    offset: 0, limit: 12, images: FRAMES.map((frame, index) => ({index, filename: `${frame}.webp`}))});
  const jobPreview = pathname.match(/^\/extension_service\/vector_db\/jobs\/demo-goose-ingest\/images\/(\d+)\/(?:thumbnail|original)$/);
  if (jobPreview) return fetch(assetUrl(Number(jobPreview[1])));
  if (pathname === '/extension_service/vector_db/warmup' && method === 'POST') return json({status: 'ready'});
  if (pathname === '/extension_service/vector_db/tasks' && method === 'POST') return json(await visualSearchTask(request));
  const searchTask = pathname.match(/^\/extension_service\/vector_db\/tasks\/([^/]+)$/);
  if (searchTask) return json(tasks.get(decodeURIComponent(searchTask[1])) || await visualSearchTask(request));

  const cluster = '/extension_service/extensions/compute-cluster';
  if (pathname === `${cluster}/nodes`) return json({nodes: NODES});
  if (pathname === `${cluster}/groups`) return json({schema_version: 'group-memberships.v1', group_count: 1,
    groups: [{index: 1, group_id: 'demo', group_name: 'OpenSight Platform 演示集群', owner_name: 'admin',
      relationship: 'owner', scope: 'central', joined_at: 1,
      credential_types: ['owner_identity', 'owner_trust']}]});
  if (pathname === `${cluster}/resource-graph`) return json(graph());
  if (pathname === `${cluster}/lan-assets`) return json({version: 1, group_id: 'demo',
    summary: {total: 0, online: 0, offline: 0, new: 0, changed: 0, networks: 2}, latest_scans: [], assets: []});
  if (pathname === `${cluster}/tasks`) return json({version: 1, group_id: 'demo', tasks: [{
    task_id: 'demo-inference-task', node_id: 'demo-gpu', node_name: '上海推理节点',
    task_type: 'system.wait', mode: 'background', state: 'succeeded', created_at: 1, updated_at: 2,
    lease_seconds: 30, progress: {completed: 12, total: 12, unit: 'images', percent: 100},
    result: {elapsed_seconds: 1.4}, attempt: 1, parameters: {seconds: 1},
  }], total: 1, counts: {succeeded: 1}, nodes: NODES.map(item => ({node_id: item.node_id, available: true}))});

  const agent = '/extension_service/extensions/llm-control';
  if (pathname === `${agent}/tasks`) return json({tasks: [], total: 0});
  if (pathname === `${agent}/conversations`) return json([]);

  return json({detail: '该操作未包含在只读演示流程中'}, method === 'GET' ? 404 : 403);
};

if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin === self.location.origin && matchDemoRoute(url.pathname)) {
      event.respondWith(handleDemoRequest(event.request));
    }
  });
}

if (typeof module !== 'undefined') {
  module.exports = {matchDemoRoute, handleDemoRequest};
  if (require.main === module) {
    const assert = require('node:assert/strict');
    (async () => {
      const login = await handleDemoRequest(new Request('http://demo/core_service/account/login', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      }));
      assert.equal(login.status, 200);
      const datasets = await (await handleDemoRequest(
        new Request('http://demo/core_service/datasets'),
      )).json();
      assert.equal(datasets.datasets[0].image_count, 12);
      const form = new FormData();
      form.set('collection', 'goose_demo_image');
      form.set('top_k', '5');
      const search = await (await handleDemoRequest(new Request(
        'http://demo/extension_service/vector_db/search', {method: 'POST', body: form},
      ))).json();
      assert.equal(search.results.length, 5);
      assert.equal(search.results[0].filename, '000016.webp');
      console.log('demo-sw self-check: ok');
    })().catch(cause => {
      console.error(cause);
      process.exitCode = 1;
    });
  }
}
