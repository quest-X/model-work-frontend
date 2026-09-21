import React, {useMemo, useState} from 'react';
import {
    ComputeClusterNode,
    ComputeResourceGraph,
    ComputeResourceGraphEntity,
    ComputeTask,
    computeNodeState,
    computeNodeLabel,
    aggregateCommunicationStates,
} from '../../../services/ComputeClusterService';

declare const __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__: boolean;

interface ResourceKnowledgeGraphProps {
    graph: ComputeResourceGraph;
    nodes: ComputeClusterNode[];
    tasks?: ComputeTask[];
    zh: boolean;
    fitWindow?: boolean;
    commercialRestricted?: boolean;
    selectedTaskType?: string;
    onSelectWorkAgent: (
        agent: ComputeResourceGraphEntity,
        candidateNodeIds: string[],
    ) => void;
    onOpenProgramRunner?: (node: ComputeClusterNode) => void;
}

interface GraphPoint {
    x: number;
    y: number;
}

interface GraphRegion {
    entityId: string;
    regionId: string;
    regionName: string;
    state: ComputeResourceGraphEntity['state'];
    nodeIds: string[];
    left: number;
    width: number;
}

interface OperationsTopology {
    points: Map<string, GraphPoint>;
    regions: GraphRegion[];
    minWidth: number;
    minHeight: number;
}

type GraphNodeRole = 'main' | 'node';

const heartbeatLabel = (seconds: number | undefined, zh: boolean): string => {
    if (seconds == null || !Number.isFinite(seconds)) return zh ? '时间未知' : 'unknown';
    if (seconds < 10) return zh ? '刚刚' : 'just now';
    if (seconds < 60) return zh ? `${Math.floor(seconds)} 秒前` : `${Math.floor(seconds)}s ago`;
    if (seconds < 3600) return zh ? `${Math.floor(seconds / 60)} 分钟前` : `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return zh ? `${Math.floor(seconds / 3600)} 小时前` : `${Math.floor(seconds / 3600)}h ago`;
    return zh ? `${Math.floor(seconds / 86400)} 天前` : `${Math.floor(seconds / 86400)}d ago`;
};

const radialPoint = (
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    angle: number,
): GraphPoint => ({
    x: centerX + Math.cos(angle) * radiusX,
    y: centerY + Math.sin(angle) * radiusY,
});

const visibleEntity = (entity: ComputeResourceGraphEntity): boolean =>
    entity.kind === 'compute_node' || entity.kind === 'managed_device';

const deviceClass = (entity: ComputeResourceGraphEntity): 'sensor' | 'controller' | 'actuator' => {
    const kind = (entity.device_kind || '').toLowerCase();
    if (['plc', 'controller', 'control', 'edge_compute'].includes(kind)) return 'controller';
    if (['actuator', 'motor', 'valve', 'robot'].includes(kind)) return 'actuator';
    return 'sensor';
};

const displayCodes = (
    entities: ComputeResourceGraphEntity[],
    nodeRoles: Map<string, GraphNodeRole>,
): Map<string, string> => {
    const prefix = (entity: ComputeResourceGraphEntity): string => {
        if (entity.kind === 'compute_node') return nodeRoles.get(entity.entity_id) === 'main' ? 'M' : 'N';
        if (entity.kind === 'work_agent') return 'A';
        if (entity.kind === 'managed_device') {
            if (entity.device_kind === 'edge_compute') return 'N';
            if (entity.device_kind === 'camera') return 'S';
            const classification = deviceClass(entity);
            return classification === 'sensor' ? 'S' : classification === 'controller' ? 'C' : 'E';
        }
        return '';
    };
    const operational = entities
        .filter(entity => Boolean(prefix(entity)))
        .sort((left, right) => {
            const order: Record<string, number> = {compute_node: 0, managed_device: 1, work_agent: 2};
            return (order[left.kind] ?? 9) - (order[right.kind] ?? 9)
                || left.entity_id.localeCompare(right.entity_id);
        });
    const counts = new Map<string, number>();
    return new Map(operational.map(entity => {
        const codePrefix = prefix(entity);
        const index = (counts.get(codePrefix) || 0) + 1;
        counts.set(codePrefix, index);
        return [entity.entity_id, `${codePrefix}-${String(index).padStart(3, '0')}`] as const;
    }));
};

const operationalProjection = (
    graph: ComputeResourceGraph,
    nodeRoles: Map<string, GraphNodeRole>,
): {
    entities: ComputeResourceGraphEntity[];
    relations: ComputeResourceGraph['relations'];
    replacementById: Map<string, string>;
} => {
    const computeByLabel = new Map(graph.entities
        .filter(entity => entity.kind === 'compute_node' && nodeRoles.get(entity.entity_id) === 'node')
        .map(entity => [entity.label.trim().toLocaleLowerCase(), entity.entity_id]));
    const replacementById = new Map(graph.entities
        .filter(entity => entity.kind === 'managed_device' && entity.device_kind === 'edge_compute')
        .flatMap(entity => {
            const replacement = computeByLabel.get(entity.label.trim().toLocaleLowerCase());
            return replacement ? [[entity.entity_id, replacement] as const] : [];
        }));
    const project = (entityId: string): string => replacementById.get(entityId) || entityId;
    return {
        entities: graph.entities.filter(entity => !replacementById.has(entity.entity_id)),
        relations: graph.relations
            .map(relation => ({
                ...relation,
                source_id: project(relation.source_id),
                target_id: project(relation.target_id),
            }))
            .filter(relation => relation.source_id !== relation.target_id),
        replacementById,
    };
};

const operationsTopology = (
    entities: ComputeResourceGraphEntity[],
    relations: ComputeResourceGraph['relations'],
    nodeRoles: Map<string, GraphNodeRole>,
): OperationsTopology => {
    const points = new Map<string, GraphPoint>();
    const nodes = entities.filter(entity => entity.kind === 'compute_node');
    const layoutChildren = entities.filter(entity =>
        entity.kind === 'managed_device'
        || (entity.kind === 'compute_node' && nodeRoles.get(entity.entity_id) !== 'main'),
    );
    const ownerByTarget = new Map(relations
        .filter(relation => relation.kind === 'manages')
        .map(relation => [relation.target_id, relation.source_id]));
    const childrenByOwner = new Map<string, ComputeResourceGraphEntity[]>();
    layoutChildren.forEach(child => {
        const ownerId = ownerByTarget.get(child.entity_id) || `unowned:${child.node_id || 'unknown'}`;
        childrenByOwner.set(ownerId, [...(childrenByOwner.get(ownerId) || []), child]);
    });
    const branchWeight = (entity: ComputeResourceGraphEntity): number =>
        entity.kind === 'compute_node' || entity.device_kind === 'edge_compute'
            ? Math.max(1, (childrenByOwner.get(entity.entity_id) || []).length)
            : 1;
    const isBranch = (entity: ComputeResourceGraphEntity): boolean =>
        entity.kind === 'compute_node' || entity.device_kind === 'edge_compute';
    const regionEntities = entities.filter(entity => entity.kind === 'compute_region');
    const regionRecords = new Map<string, Omit<GraphRegion, 'left' | 'width'>>();
    regionEntities.forEach(region => regionRecords.set(region.entity_id, {
        entityId: region.entity_id,
        regionId: region.region_id || region.region_name || region.label,
        regionName: region.region_name || region.region_id || region.label,
        state: region.state,
        nodeIds: [],
    }));
    nodes.forEach(node => {
        const relation = relations.find(item => item.kind === 'contains'
            && item.target_id === node.entity_id
            && regionRecords.has(item.source_id));
        const fallbackId = `region-fallback:${node.region_id || 'unassigned'}`;
        const regionId = relation?.source_id || fallbackId;
        if (!regionRecords.has(regionId)) {
            regionRecords.set(regionId, {
                entityId: regionId,
                regionId: node.region_id || node.region_name || 'unassigned',
                regionName: node.region_name || node.region_id || '未分配地域',
                state: node.state,
                nodeIds: [],
            });
        }
        const record = regionRecords.get(regionId);
        if (!record) return;
        record.nodeIds.push(node.entity_id);
    });
    const orderedRegions = [...regionRecords.values()]
        .filter(region => region.nodeIds.length > 0)
        .sort((left, right) => left.regionId.localeCompare(right.regionId) || left.entityId.localeCompare(right.entityId));
    const regions = orderedRegions.map((region): GraphRegion => ({...region, left: 0, width: 100}));
    let minWidth = 16;
    let minHeight = 440;
    regions.forEach(region => {
        const regionalPoints = new Map<string, GraphPoint>();
        const centerX = region.left + region.width / 2;
        const centerY = 52;
        const rootNodeIds = region.nodeIds.filter(nodeId =>
            nodeRoles.get(nodeId) === 'main' || !ownerByTarget.has(nodeId));
        const layoutNodeIds = rootNodeIds.length ? rootNodeIds : region.nodeIds;
        const directOwnerIndex = layoutNodeIds.findIndex(nodeId =>
            (childrenByOwner.get(nodeId) || []).some(child => !isBranch(child)));
        const orderedNodeIds = directOwnerIndex > 0
            ? [...layoutNodeIds.slice(directOwnerIndex), ...layoutNodeIds.slice(0, directOwnerIndex)]
            : layoutNodeIds;
        const nodeCount = orderedNodeIds.length;
        const sectorSize = Math.PI * 2 / Math.max(1, nodeCount);
        const directSensors = orderedNodeIds.flatMap(nodeId =>
            (childrenByOwner.get(nodeId) || []).filter(child => !isBranch(child)));
        let directSensorIndex = 0;
        orderedNodeIds.forEach((nodeId, nodeIndex) => {
            const nodeAngle = -Math.PI / 2 + sectorSize * nodeIndex;
            regionalPoints.set(nodeId, nodeCount === 1
                ? {x: centerX, y: centerY}
                : radialPoint(centerX, centerY, region.width * .12, 10, nodeAngle));
            const ownedChildren = childrenByOwner.get(nodeId) || [];
            const childrenWeight = Math.max(1, ownedChildren.reduce((total, child) => total + branchWeight(child), 0));
            let usedWeight = 0;
            ownedChildren.forEach(child => {
                const weight = branchWeight(child);
                const childAngle = nodeCount === 1
                    ? -Math.PI / 2 + Math.PI * 2 * (usedWeight + weight / 2) / childrenWeight
                    : nodeAngle - sectorSize * .38 + sectorSize * .76 * (usedWeight + weight / 2) / childrenWeight;
                regionalPoints.set(child.entity_id, isBranch(child)
                    ? radialPoint(centerX, centerY, region.width * .24, 21, childAngle)
                    : {
                        x: centerX + region.width * .8 * ((directSensorIndex++ + .5) / directSensors.length - .5),
                        y: 24,
                    });
                const grandchildren = childrenByOwner.get(child.entity_id) || [];
                const branchArc = (nodeCount === 1 ? Math.PI * 2 : sectorSize * .76) * weight / childrenWeight;
                grandchildren.forEach((grandchild, index) => regionalPoints.set(
                    grandchild.entity_id,
                    radialPoint(centerX, centerY, region.width * .4, 38,
                        childAngle + branchArc * ((index + .5) / grandchildren.length - .5)),
                ));
                usedWeight += weight;
            });
        });
        // Keep fixed-size cards readable; expanding the canvas preserves the radial ownership layout.
        // ponytail: pairwise bounds suit inventory-sized graphs; use spatial indexing for thousands of cards.
        const entries = [...regionalPoints.entries()];
        let scale = 1;
        entries.forEach(([id, point], i) => {
            const main = nodeRoles.get(id) === 'main';
            entries.slice(0, i).forEach(([otherId, other]) => {
                const otherMain = nodeRoles.get(otherId) === 'main';
                // CSS card bounds plus 16px breathing room and the device's raised code badge.
                const width = ((main ? 92 : 136) + (otherMain ? 92 : 136)) / 2 + 16;
                const height = ((main ? 92 : 58) + (otherMain ? 92 : 58)) / 2 + 26;
                scale = Math.max(scale, Math.min(
                    width / (Math.abs(point.x - other.x) * 7.2),
                    height / (Math.abs(point.y - other.y) * 4.4),
                ));
            });
        });
        region.left = minWidth;
        region.width = Math.ceil(720 * scale);
        minHeight = Math.max(minHeight, Math.ceil(440 * scale));
        regionalPoints.forEach((point, id) => points.set(id, {
            x: region.left + point.x * region.width / 100,
            y: point.y,
        }));
        minWidth += region.width + 16;
    });
    minWidth = Math.max(720, minWidth);
    regions.forEach(region => {
        region.left = region.left / minWidth * 100;
        region.width = region.width / minWidth * 100;
    });
    points.forEach(point => { point.x = point.x / minWidth * 100; });
    const unowned = layoutChildren.filter(child => !points.has(child.entity_id));
    unowned.forEach((child, index) => points.set(
        child.entity_id,
        radialPoint(50, 52, 40, 38, -Math.PI / 2 + Math.PI * 2 * index / Math.max(1, unowned.length)),
    ));
    return {points, regions, minWidth, minHeight};
};

const agentLabel = (
    entity: Pick<ComputeResourceGraphEntity, 'label' | 'task_type'>,
    zh: boolean,
): string => {
    if (entity.task_type === 'information.web_fetch') return zh ? '公开信息采集' : 'Public information';
    if (entity.task_type === 'system.wait') return zh ? '等待诊断' : 'Wait diagnostic';
    if (entity.task_type === 'network.lan_discovery') return zh ? '局域网发现' : 'LAN discovery';
    return entity.label;
};

const availabilityLabel = (available: boolean, zh: boolean): string =>
    available ? (zh ? '正常' : 'Normal') : (zh ? '故障' : 'Fault');

const sensorKindLabel = (entity: ComputeResourceGraphEntity, zh: boolean): string => {
    if (entity.device_kind === 'edge_compute') return zh ? '边缘计算设备' : 'Edge device';
    const classification = deviceClass(entity);
    if (classification === 'controller') return zh ? '控制器' : 'Controller';
    if (classification === 'actuator') return zh ? '执行器' : 'Actuator';
    if (entity.device_kind === 'camera') return zh ? '摄像头传感器' : 'Camera sensor';
    return zh ? '传感器' : 'Sensor';
};

const deviceStatusLabel = (status: string | null | undefined, zh: boolean): string => {
    const healthy = ['registered', 'online', 'available', 'healthy'].includes(status || '');
    return availabilityLabel(healthy, zh);
};

// The operations canvas intentionally keeps all bilingual visual and hover states in one component.
// eslint-disable-next-line complexity
export const ResourceKnowledgeGraph: React.FC<ResourceKnowledgeGraphProps> = ({
    graph,
    nodes: clusterNodes,
    tasks = [],
    zh,
    fitWindow = false,
    commercialRestricted = (
        typeof __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__ !== 'undefined'
        && __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__
    ),
    onOpenProgramRunner,
}) => {
    const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
    const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null);
    const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
    const [pinnedEntityId, setPinnedEntityId] = useState<string | null>(null);
    const index = useMemo(
        () => new Map(graph.entities.map(entity => [entity.entity_id, entity])),
        [graph.entities],
    );
    const nodeIndex = useMemo(
        () => new Map(clusterNodes.map(node => [node.node_id, node])),
        [clusterNodes],
    );
    const nodeRoles = useMemo(
        () => new Map(graph.entities
            .filter(entity => entity.kind === 'compute_node')
            .map(entity => [
                entity.entity_id,
                entity.node_id && nodeIndex.get(entity.node_id)?.role === 'main' ? 'main' : 'node',
            ] as const)),
        [graph.entities, nodeIndex],
    );
    const operationalGraph = useMemo(
        () => operationalProjection(graph, nodeRoles),
        [graph, nodeRoles],
    );
    const visibleEntities = useMemo(
        () => operationalGraph.entities.filter(visibleEntity),
        [operationalGraph.entities],
    );
    const visibleEntityIds = useMemo(
        () => new Set(visibleEntities.map(entity => entity.entity_id)),
        [visibleEntities],
    );
    const visibleRelations = useMemo(
        () => operationalGraph.relations.filter(relation =>
            relation.kind === 'manages'
            && visibleEntityIds.has(relation.source_id)
            && visibleEntityIds.has(relation.target_id),
        ),
        [operationalGraph.relations, visibleEntityIds],
    );
    const topology = useMemo(
        () => operationsTopology(operationalGraph.entities, operationalGraph.relations, nodeRoles),
        [nodeRoles, operationalGraph.entities, operationalGraph.relations],
    );
    const points = topology.points;
    const codes = useMemo(
        () => displayCodes(operationalGraph.entities, nodeRoles),
        [nodeRoles, operationalGraph.entities],
    );
    const graphNodes = visibleEntities.filter(entity => entity.kind === 'compute_node');
    const activeTaskFlows = tasks.flatMap(task => {
        const sourceId = task.source_entity_id
            ? operationalGraph.replacementById.get(task.source_entity_id) || task.source_entity_id
            : undefined;
        const targetId = task.target_entity_id
            ? operationalGraph.replacementById.get(task.target_entity_id) || task.target_entity_id
            : undefined;
        const source = sourceId ? index.get(sourceId) : undefined;
        const target = targetId ? index.get(targetId) : undefined;
        return (task.state === 'queued' || task.state === 'running') && source && target && source !== target
            ? [{task, source, target}]
            : [];
    });
    const edgeDevices = visibleEntities.filter(entity =>
        entity.kind === 'managed_device' && entity.device_kind === 'edge_compute',
    );
    const sensors = visibleEntities.filter(entity =>
        entity.kind === 'managed_device' && entity.device_kind !== 'edge_compute',
    );
    const workerNodes = graphNodes.filter(entity => nodeRoles.get(entity.entity_id) === 'node');
    const nodeTones = new Map(graphNodes.map(entity => {
        const node = entity.node_id ? nodeIndex.get(entity.node_id) : undefined;
        const state = computeNodeState(node);
        return [entity.entity_id, state === 'normal' ? 'online' : state === 'abnormal' ? 'offline' : 'warning'];
    }));
    const inspectedEntityId = pinnedEntityId || hoveredEntityId;
    const inspectedEntity = inspectedEntityId ? index.get(inspectedEntityId) : undefined;
    const inspectedPoint = inspectedEntityId ? points.get(inspectedEntityId) : undefined;
    const hoveredRelation = visibleRelations.find(relation => relation.relation_id === hoveredRelationId);
    const hoveredRelationSource = hoveredRelation ? index.get(hoveredRelation.source_id) : undefined;
    const hoveredRelationTarget = hoveredRelation ? index.get(hoveredRelation.target_id) : undefined;
    const hoveredRelationSourcePoint = hoveredRelation ? points.get(hoveredRelation.source_id) : undefined;
    const hoveredRelationTargetPoint = hoveredRelation ? points.get(hoveredRelation.target_id) : undefined;
    const hoveredTaskFlow = activeTaskFlows.find(({task}) => task.task_id === hoveredTaskId);
    const hoveredTaskSourcePoint = hoveredTaskFlow ? points.get(hoveredTaskFlow.source.entity_id) : undefined;
    const hoveredTaskTargetPoint = hoveredTaskFlow ? points.get(hoveredTaskFlow.target.entity_id) : undefined;

    const dependencyFor = (nodeEntity: ComputeResourceGraphEntity, dependencyId: string): boolean => {
        const relation = graph.relations.find(item =>
            item.kind === 'depends_on'
            && item.source_id === nodeEntity.entity_id
            && index.get(item.target_id)?.dependency_id === dependencyId,
        );
        if (relation) return relation.active && index.get(relation.target_id)?.state === 'available';
        const node = nodeEntity.node_id ? nodeIndex.get(nodeEntity.node_id) : undefined;
        if (dependencyId === 'control_ssh') return Boolean(node?.online && node.network.ssh_available);
        if (dependencyId === 'tailscale') return Boolean(node?.online && node.network.online);
        return node?.network_dependencies.some(item => item.dependency_id === dependencyId && item.state === 'healthy') ?? false;
    };

    const callableAgentsFor = (nodeEntity: ComputeResourceGraphEntity): ComputeResourceGraphEntity[] =>
        graph.relations
            .filter(relation => relation.kind === 'can_execute'
                && relation.source_id === nodeEntity.entity_id
                && relation.active)
            .map(relation => index.get(relation.target_id))
            .filter((entity): entity is ComputeResourceGraphEntity => Boolean(entity && entity.kind === 'work_agent'));

    const ownerFor = (device: ComputeResourceGraphEntity): ComputeResourceGraphEntity | undefined => {
        const relation = graph.relations.find(item => item.kind === 'manages' && item.target_id === device.entity_id);
        return relation ? index.get(relation.source_id) : undefined;
    };

    return <section className='ComputeKnowledgePanel' aria-label={zh ? '主节点、计算节点与摄像头拓扑' : 'Main node, compute node, and camera topology'}>
        <div className='ComputeKnowledgeHeading'>
            <div>
                <span>{zh ? '地域拓扑 (悬浮查看 / 双击固定)' : 'Regional topology · Hover / double-click to pin'}</span>
                <h3>{zh ? '计算群地域 Graph' : 'Compute cluster regional graph'}</h3>
                <p>{zh
                    ? '图谱按实际角色与归属关系展示主节点、计算节点及其摄像头。'
                    : 'The graph reflects actual roles and ownership between main nodes, compute nodes, and their cameras.'}</p>
            </div>
            <div className='ComputeKnowledgeStats graph-summary'>
                <div><strong>{workerNodes.length + edgeDevices.length + sensors.length}</strong><span>{zh ? '设备总数' : 'Total devices'}</span></div>
                <div><strong>{workerNodes.length + edgeDevices.length}</strong><span>{zh ? '计算节点' : 'Compute nodes'}</span></div>
                <div><strong>{sensors.length}</strong><span>{zh ? '摄像头' : 'Cameras'}</span></div>
            </div>
        </div>

        <div className='ComputeKnowledgeLegend'>
            {!commercialRestricted && <span><i className='entity-shape region'/>{zh ? '地域' : 'Region'}</span>}
            <span><i className='entity-shape circle'/>{zh ? '主节点' : 'Main node'}</span>
            <span><i className='entity-shape rounded-rectangle edge-device'/>{zh ? '计算节点' : 'Compute node'}</span>
            <span><i className='entity-shape rounded-rectangle sensor'/>{zh ? '摄像头' : 'Camera'}</span>
            {!commercialRestricted && <span><i className='entity-shape task-flow'/>{zh ? '数据包' : 'Packet'}</span>}
        </div>

        <div className={`ComputeGraphViewport${fitWindow ? ' fit-window' : ''}`}>
            <div className='ComputeGraphFit'>
            <div
                className={`ComputeGraphScene operations-only${hoveredRelation || hoveredTaskFlow ? ' has-relation-focus' : ''}`}
                data-layout='radial'
                style={{
                    minWidth: fitWindow ? 0 : topology.minWidth,
                    minHeight: fitWindow ? 0 : topology.minHeight,
                }}
                role='figure'
                aria-label={zh ? '主节点、计算节点与摄像头关系图' : 'Main node, compute node, and camera graph'}
                onClick={event => {
                    const target = event.target as Element;
                    if (!target.closest('[data-testid="resource-graph-node"]')) setPinnedEntityId(null);
                }}
            >
                <div className='ComputeGraphRegions'>
                    {topology.regions.map(region => <div
                        key={region.entityId}
                        className={`ComputeGraphRegion state-${aggregateCommunicationStates(region.nodeIds.map(id =>
                            nodeTones.get(id) === 'online' ? 'normal' : nodeTones.get(id) === 'offline' ? 'abnormal' : 'fault'
                        ))}`}
                        style={{flexGrow: region.width}}
                        data-testid='resource-graph-region'
                    >
                        <span>{zh ? '地域' : 'Region'}</span>
                        <strong>{zh ? region.regionName : region.regionId}</strong>
                        <small>{region.nodeIds.filter(id => nodeTones.get(id) === 'online').length}/{region.nodeIds.length} {zh ? '正常节点' : 'Normal nodes'}</small>
                    </div>)}
                </div>
                <svg
                    className='ComputeGraphEdges'
                    viewBox='0 0 1000 440'
                    preserveAspectRatio='none'
                    data-testid='resource-node-link-graph'
                    aria-label={zh ? '设备连接线' : 'Device connections'}
                >
                    {visibleRelations.map(relation => {
                        const source = points.get(relation.source_id);
                        const target = points.get(relation.target_id);
                        const sourceEntity = index.get(relation.source_id);
                        const targetEntity = index.get(relation.target_id);
                        if (!source || !target || !sourceEntity || !targetEntity) return null;
                        const x1 = source.x * 10;
                        const y1 = source.y * 4.4;
                        const x2 = target.x * 10;
                        const y2 = target.y * 4.4;
                        const focused = hoveredRelationId === relation.relation_id;
                        const muted = Boolean(hoveredRelationId || hoveredTaskId) && !focused;
                        return <React.Fragment key={relation.relation_id}>
                            <line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                className={`ComputeGraphEdge manages ${deviceClass(targetEntity)} ${relation.active ? 'active' : 'inactive'} ${focused ? 'focused' : ''} ${muted ? 'muted' : ''}`}
                                data-testid='resource-graph-edge'
                                data-relation-kind='manages'
                                data-relation-id={relation.relation_id}
                                aria-hidden='true'
                            />
                            {!relation.active && <g
                                className={`ComputeGraphEdgeUnavailable ${focused ? 'focused' : ''} ${muted ? 'muted' : ''}`}
                                transform={`translate(${(x1 + x2) / 2} ${(y1 + y2) / 2})`}
                                data-testid='resource-graph-unavailable-marker'
                                aria-hidden='true'
                            >
                                <line x1='-5' y1='-5' x2='5' y2='5'/>
                                <line x1='5' y1='-5' x2='-5' y2='5'/>
                            </g>}
                            <line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                className='ComputeGraphEdgeHit'
                                data-testid='resource-graph-edge-hit'
                                data-relation-id={relation.relation_id}
                                tabIndex={0}
                                aria-label={`${zh ? '连接' : 'Connection'} ${sourceEntity.label} ↔ ${targetEntity.label}`}
                                onMouseEnter={() => setHoveredRelationId(relation.relation_id)}
                                onMouseLeave={() => setHoveredRelationId(current => current === relation.relation_id ? null : current)}
                                onFocus={() => setHoveredRelationId(relation.relation_id)}
                                onBlur={() => setHoveredRelationId(current => current === relation.relation_id ? null : current)}
                            />
                        </React.Fragment>;
                    })}
                    {activeTaskFlows.map(({task, source, target}) => {
                        const sourcePoint = points.get(source.entity_id);
                        const targetPoint = points.get(target.entity_id);
                        if (!sourcePoint || !targetPoint) return null;
                        const path = `M ${sourcePoint.x * 10} ${sourcePoint.y * 4.4} L ${targetPoint.x * 10} ${targetPoint.y * 4.4}`;
                        const focused = hoveredTaskId === task.task_id;
                        const muted = Boolean(hoveredRelationId) || Boolean(hoveredTaskId && !focused);
                        return <g
                            key={task.task_id}
                            className={`ComputeGraphTaskFlow ${focused ? 'focused' : ''} ${muted ? 'muted' : ''}`}
                            data-testid='resource-graph-task-flow'
                            data-source-entity-id={task.source_entity_id}
                            data-target-entity-id={task.target_entity_id}
                            role='img'
                            aria-label={`${zh ? '任务流' : 'Task flow'} ${source.label} → ${target.label}`}
                        >
                            <path className='ComputeGraphTaskPath' d={path}/>
                            {[0, .55, 1.1].map(begin => <circle key={begin} r='4'>
                                <animateMotion path={path} dur='1.65s' begin={`${begin}s`} repeatCount='indefinite'/>
                            </circle>)}
                            <path
                                className='ComputeGraphTaskFlowHit'
                                d={path}
                                tabIndex={0}
                                aria-label={`${zh ? '查看任务流' : 'Inspect task flow'} ${source.label} → ${target.label}`}
                                onMouseEnter={() => setHoveredTaskId(task.task_id)}
                                onMouseLeave={() => setHoveredTaskId(current => current === task.task_id ? null : current)}
                                onFocus={() => setHoveredTaskId(task.task_id)}
                                onBlur={() => setHoveredTaskId(current => current === task.task_id ? null : current)}
                            />
                        </g>;
                    })}
                </svg>

                {visibleEntities.map(
                    // Visible node and sensor variants share one accessible interaction path.
                    // eslint-disable-next-line complexity
                    entity => {
                    const point = points.get(entity.entity_id);
                    if (!point) return null;
                    const node = entity.node_id ? nodeIndex.get(entity.node_id) : undefined;
                    const isNode = entity.kind === 'compute_node';
                    const nodeRole = isNode ? nodeRoles.get(entity.entity_id) || 'node' : undefined;
                    const classification = entity.kind === 'managed_device' ? deviceClass(entity) : '';
                    const isHovered = hoveredEntityId === entity.entity_id;
                    const isPinned = pinnedEntityId === entity.entity_id;
                    const isRelationEndpoint = hoveredRelation?.source_id === entity.entity_id
                        || hoveredRelation?.target_id === entity.entity_id
                        || hoveredTaskFlow?.source.entity_id === entity.entity_id
                        || hoveredTaskFlow?.target.entity_id === entity.entity_id;
                    return <button
                        type='button'
                        key={entity.entity_id}
                        className={`ComputeGraphNode ${entity.kind} ${nodeRole ? `role-${nodeRole}` : ''} ${classification} ${entity.device_kind === 'edge_compute' ? 'edge-device' : ''} state-${entity.state} ${isNode
                            ? `node-${nodeTones.get(entity.entity_id)}`
                            : 'sensor-node'} ${isHovered || isPinned ? 'focused' : ''} ${isPinned ? 'pinned' : ''} ${isRelationEndpoint ? 'relation-focused' : ''} ${(hoveredRelation || hoveredTaskFlow) && !isRelationEndpoint ? 'muted' : ''}`}
                        style={{left: `${point.x}%`, top: `${point.y}%`}}
                        onMouseEnter={() => setHoveredEntityId(entity.entity_id)}
                        onMouseLeave={() => setHoveredEntityId(current => current === entity.entity_id ? null : current)}
                        onFocus={() => setHoveredEntityId(entity.entity_id)}
                        onBlur={() => setHoveredEntityId(current => current === entity.entity_id ? null : current)}
                        onDoubleClick={() => {
                            if (!isNode) return;
                            setPinnedEntityId(current => current === entity.entity_id ? null : entity.entity_id);
                            setHoveredEntityId(current => current === entity.entity_id ? null : current);
                        }}
                        aria-pressed={isNode ? isPinned : undefined}
                        aria-label={isNode
                            ? `${zh ? '查看' : 'Inspect'} ${entity.label} ${zh ? '节点信息' : 'node details'}`
                            : `${zh ? '查看' : 'Inspect'} ${entity.label} ${zh ? '设备信息' : 'device details'}`}
                        data-testid='resource-graph-node'
                        data-entity-kind={entity.kind}
                        data-entity-role={nodeRole}
                        data-entity-shape={nodeRole === 'main' ? 'circle' : 'rounded-rectangle'}
                        data-entity-state={entity.state}
                    >
                        <i>{codes.get(entity.entity_id)}</i>
                        <span>{isNode
                            ? nodeRole === 'main'
                                ? (zh ? '主节点' : 'Main node')
                                : (zh ? '计算节点' : 'Compute node')
                            : sensorKindLabel(entity, zh)}</span>
                        <strong>{entity.label}</strong>
                        <small>{isNode
                            ? `${zh ? '心跳' : 'Heartbeat'} ${heartbeatLabel(node?.heartbeat_age_seconds, zh)}`
                            : entity.device_kind === 'edge_compute'
                                ? entity.device_model || (zh ? '型号未知' : 'Unknown model')
                                : `${entity.device_model || (zh ? '型号未知' : 'Unknown model')} · ${entity.channels || 0} ${zh ? '通道' : 'channels'}`}</small>
                    </button>;
                    },
                )}

                {hoveredRelation && hoveredRelationSource && hoveredRelationTarget
                    && hoveredRelationSourcePoint && hoveredRelationTargetPoint && <aside
                    className='ComputeGraphEdgeLabel'
                    style={{
                        left: `${(hoveredRelationSourcePoint.x + hoveredRelationTargetPoint.x) / 2}%`,
                        top: `${(hoveredRelationSourcePoint.y + hoveredRelationTargetPoint.y) / 2}%`,
                    }}
                    role='status'
                    aria-label={`${hoveredRelationSource.label} ${zh ? '与' : 'and'} ${hoveredRelationTarget.label} ${zh ? '连接' : 'connection'}`}
                >
                    <span>{zh ? '设备连接' : 'Device connection'}</span>
                    <strong>{hoveredRelationSource.label}<b>↔</b>{hoveredRelationTarget.label}</strong>
                </aside>}

                {hoveredTaskFlow && hoveredTaskSourcePoint && hoveredTaskTargetPoint && <aside
                    className='ComputeGraphEdgeLabel task-flow'
                    style={{
                        left: `${(hoveredTaskSourcePoint.x + hoveredTaskTargetPoint.x) / 2}%`,
                        top: `${(hoveredTaskSourcePoint.y + hoveredTaskTargetPoint.y) / 2}%`,
                    }}
                    role='status'
                    aria-label={`${hoveredTaskFlow.source.label} ${zh ? '向' : 'to'} ${hoveredTaskFlow.target.label} ${zh ? '任务流' : 'task flow'}`}
                >
                    <span>{zh ? '实时任务流' : 'Live task flow'}</span>
                    <strong>{hoveredTaskFlow.source.label}<b>→</b>{hoveredTaskFlow.target.label}</strong>
                </aside>}

                {inspectedEntity && <aside
                    className={`ComputeGraphHoverCard anchored ${pinnedEntityId === inspectedEntity.entity_id ? 'pinned' : ''}`}
                    style={{
                        '--hover-anchor-x': `${inspectedPoint?.x || 50}%`,
                        '--hover-anchor-y': `${inspectedPoint?.y || 50}%`,
                        '--hover-shift-x': inspectedPoint && inspectedPoint.x > 50 ? 'calc(-100% - 58px)' : '58px',
                        '--hover-shift-y': inspectedPoint && inspectedPoint.y < 28 ? '-10%' : inspectedPoint && inspectedPoint.y > 72 ? '-90%' : '-50%',
                    } as React.CSSProperties}
                    role='status'
                    aria-label={`${inspectedEntity.label} ${zh ? '运维信息' : 'operations details'}`}
                >
                    {/* The node card derives transport and agent state from authoritative graph relations. */}
                    {/* eslint-disable-next-line complexity */}
                    {inspectedEntity.kind === 'compute_node' ? (() => {
                        const node = inspectedEntity.node_id ? nodeIndex.get(inspectedEntity.node_id) : undefined;
                        const nodeRole = nodeRoles.get(inspectedEntity.entity_id) || 'node';
                        const tone = nodeTones.get(inspectedEntity.entity_id);
                        const agents = callableAgentsFor(inspectedEntity);
                        const sshAvailable = dependencyFor(inspectedEntity, 'control_ssh');
                        const publicAvailable = dependencyFor(inspectedEntity, 'public_http');
                        const tailscaleAvailable = dependencyFor(inspectedEntity, 'tailscale');
                        const runnerAvailable = Boolean(
                            node?.online && node.capabilities.includes('runtime.read.v1'),
                        );
                        return <>
                            <span>{zh
                                ? `${nodeRole === 'main' ? '主节点' : '计算节点'} ${codes.get(inspectedEntity.entity_id)} · 运维信息${pinnedEntityId === inspectedEntity.entity_id ? ' · 已固定（双击节点或点击空白取消）' : ''}`
                                : `${nodeRole === 'main' ? 'Main node' : 'Compute node'} ${codes.get(inspectedEntity.entity_id)} · Operations${pinnedEntityId === inspectedEntity.entity_id ? ' · Pinned (double-click node or click blank space to unpin)' : ''}`}</span>
                            <strong>{inspectedEntity.label}</strong>
                            <small className={tone}>{computeNodeLabel(node, zh)} · {node?.online
                                ? (zh ? '心跳' : 'heartbeat')
                                : (zh ? '最后心跳' : 'last heartbeat')}{' '}{heartbeatLabel(node?.heartbeat_age_seconds, zh)}</small>
                            {node && onOpenProgramRunner && <div className='ComputeGraphNodeActions'>
                                <button
                                    type='button'
                                    onClick={event => {
                                        event.stopPropagation();
                                        onOpenProgramRunner(node);
                                    }}
                                >
                                    <span>{runnerAvailable
                                        ? (zh ? '正常' : 'Normal')
                                        : node.online ? (zh ? '待升级' : 'Upgrade required') : computeNodeLabel(node, zh)}</span>
                                    <strong>{zh ? '程序运行器' : 'Program runner'}</strong>
                                    <small>{zh ? '程序 · 接口 · 结果 · 日志' : 'Programs · APIs · results · logs'}</small>
                                </button>
                            </div>}
                            <div className='ComputeGraphHoverRoutes'>
                                <div className={sshAvailable ? 'available' : 'unavailable'}>
                                    <span>{zh ? 'SSH 通路' : 'SSH route'}</span><strong>{availabilityLabel(sshAvailable, zh)}</strong>
                                    <small>{node?.network.self_name || node?.network.addresses.join(' · ') || (zh ? '地址待节点上报' : 'Address pending')}</small>
                                </div>
                                <div className={publicAvailable ? 'available' : 'unavailable'}>
                                    <span>{zh ? '公网出口' : 'Public egress'}</span><strong>{availabilityLabel(publicAvailable, zh)}</strong>
                                    <small>{zh ? '公开网络访问' : 'Public network access'}</small>
                                </div>
                                <div className={tailscaleAvailable ? 'available' : 'unavailable'}>
                                    <span>{zh ? 'Tailscale 私有组网' : 'Tailscale private overlay'}</span><strong>{availabilityLabel(tailscaleAvailable, zh)}</strong>
                                    <small>{node?.network.tailnet || (zh ? '私有链路' : 'Private route')}</small>
                                </div>
                            </div>
                            <div className='ComputeGraphHoverAgents'>
                                <span>{zh ? '可调用任务执行器' : 'Callable task workers'}</span>
                                {agents.length ? <div>{agents.map(agent => <em key={agent.entity_id}>{codes.get(agent.entity_id)} · {agentLabel(agent, zh)}</em>)}</div>
                                    : <small>{zh ? '暂无可调用任务执行器' : 'No callable task worker'}</small>}
                            </div>
                        </>;
                    })() : <>
                        <span>{sensorKindLabel(inspectedEntity, zh)} {codes.get(inspectedEntity.entity_id)} · {deviceStatusLabel(inspectedEntity.device_status, zh)}</span>
                        <strong>{inspectedEntity.label}</strong>
                        <small>{inspectedEntity.device_model || (zh ? '型号未知' : 'Unknown model')}</small>
                        <div className='ComputeGraphSensorFacts'>
                            {inspectedEntity.device_kind !== 'edge_compute'
                                && <em>{inspectedEntity.channels || 0} {zh ? '个通道' : 'channels'}</em>}
                            <em>{zh ? '接入方式' : 'Provider'} · {inspectedEntity.provider || '—'}</em>
                            <em>{zh ? '上级设备' : 'Owner'} · {ownerFor(inspectedEntity)?.label || (zh ? '未归属' : 'Unassigned')}</em>
                        </div>
                    </>}
                </aside>}
            </div>
            </div>
        </div>
    </section>;
};
