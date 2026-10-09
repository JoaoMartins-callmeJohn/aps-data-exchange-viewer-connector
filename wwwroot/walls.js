// Wall drawing tool built on the APS Viewer Scene API
// (https://aps.autodesk.com/blog/introducing-scene-api-aps-viewer), with snapping as in
// https://aps.autodesk.com/blog/snappy-viewer-tools (requires the Autodesk.Snapping extension to be loaded).
// Namespaces are resolved once the viewer is initialized (see WallTool constructor).
const av = Autodesk.Viewing;
let avs, avm;

const DEFAULT_WALL_COLOR = '#c8c8c8';
const PREVIEW_COLOR = 0xff9900;
const ESCAPE_KEY = 27;

/**
 * Computes the 6 faces of a wall box: base line start → end at the start Z, extruded along +Z.
 * Mirrors DataExchangeService.BuildWallMesh on the server.
 */
export function buildWallBox({ start, end, height, thickness }) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const dirX = dx / length, dirY = dy / length;
    const offX = -dirY * thickness / 2, offY = dirX * thickness / 2;
    const z0 = start.z, z1 = start.z + height;
    const a = [start.x + offX, start.y + offY];
    const b = [start.x - offX, start.y - offY];
    const c = [end.x - offX, end.y - offY];
    const d = [end.x + offX, end.y + offY];
    const v = (p, z) => [p[0], p[1], z];
    return [
        { corners: [v(b, z0), v(a, z0), v(d, z0), v(c, z0)], normal: [0, 0, -1] },        // bottom
        { corners: [v(a, z1), v(b, z1), v(c, z1), v(d, z1)], normal: [0, 0, 1] },         // top
        { corners: [v(a, z0), v(b, z0), v(b, z1), v(a, z1)], normal: [-dirX, -dirY, 0] }, // start cap
        { corners: [v(c, z0), v(d, z0), v(d, z1), v(c, z1)], normal: [dirX, dirY, 0] },   // end cap
        { corners: [v(d, z0), v(a, z0), v(a, z1), v(d, z1)], normal: [-dirY, dirX, 0] },  // side +offset
        { corners: [v(b, z0), v(c, z0), v(c, z1), v(b, z1)], normal: [dirY, -dirX, 0] },  // side -offset
    ];
}

function createWallGeometry(wall) {
    const faces = buildWallBox(wall);
    const positions = new Float32Array(faces.length * 4 * 3);
    const normals = new Float32Array(faces.length * 4 * 3);
    const indices = new Uint16Array(faces.length * 6);
    faces.forEach((face, f) => {
        face.corners.forEach((corner, k) => {
            positions.set(corner, (f * 4 + k) * 3);
            normals.set(face.normal, (f * 4 + k) * 3);
        });
        const i = f * 4;
        indices.set([i, i + 1, i + 2, i, i + 2, i + 3], f * 6);
    });
    const geometry = new avs.BufferGeometry();
    geometry.setAttribute('position', new avs.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new avs.BufferAttribute(normals, 3));
    geometry.setIndices(indices);
    return geometry;
}

// Snap results that resolve to a single point; for edges and faces we use the point under the cursor.
function isPointSnap(geomType) {
    const SnapType = Autodesk.Viewing.MeasureCommon.SnapType;
    return [SnapType.SNAP_VERTEX, SnapType.SNAP_MIDPOINT, SnapType.SNAP_INTERSECTION, SnapType.SNAP_CIRCLE_CENTER, SnapType.RASTER_PIXEL]
        .includes(geomType);
}

export class WallTool {
    constructor(viewer) {
        avs = Autodesk.Viewing.Scene;
        avm = Autodesk.Viewing.Math;
        if (!avs || !avm) {
            throw new Error('The Scene API is not available in this viewer version.');
        }
        this.viewer = viewer;
        this.names = ['walls-tool'];
        this.sourceModel = null;
        this.wallModel = null;
        this.walls = [];          // { start, end, height, thickness, instanceId } in viewer world coordinates
        this.start = null;
        this.previewId = -1;
        this.height = 10;
        this.thickness = 0.66;
        this.color = DEFAULT_WALL_COLOR; // '#rrggbb', applied to every wall
        this.onChange = () => { };
        this.snapper = new Autodesk.Viewing.Extensions.Snapping.Snapper(viewer, { renderSnappedGeometry: true, renderSnappedTopology: true });
        viewer.toolController.registerTool(this.snapper);
        viewer.toolController.registerTool(this);
    }

    // Starts a fresh drawing session on top of a newly loaded model.
    attach(sourceModel) {
        this.deactivateDrawing();
        this.sourceModel = sourceModel;
        this.walls = [];
        this.wallModel = new av.Model();
        this.viewer.showModel(this.wallModel, true); // keep the active navigation tools
        this.instances = this.wallModel.getInstances();
        this.wallMaterial = this.createWallMaterial(this.color);
        this.previewMaterial = new avs.StandardMaterial({
            color: PREVIEW_COLOR, opacity: 0.5, transparent: true,
            specularColor: 0x111111, specularPower: 20, fresnelStrength: 0, side: avs.Side.Double
        });
        this.onChange();
    }

    // Walls are explicitly opaque; only the rubber-band preview is rendered in the transparent pass.
    createWallMaterial(color) {
        return new avs.StandardMaterial({
            color: new avs.Color(color), opacity: 1, transparent: false, depthWrite: true, depthTest: true,
            specularColor: 0x111111, specularPower: 20, fresnelStrength: 0, side: avs.Side.Double
        });
    }

    // Assigns a new material to every wall (and to walls drawn from now on) via InstanceCollection3D.setMaterial.
    setColor(color) {
        this.color = color;
        if (!this.instances) {
            return;
        }
        this.wallMaterial = this.createWallMaterial(color);
        for (const wall of this.walls) {
            this.instances.setMaterial(wall.instanceId, this.wallMaterial);
        }
        this.viewer.refresh(true);
    }

    get isDrawing() {
        return this.viewer.toolController.isToolActivated(this.getName());
    }

    activateDrawing() {
        if (this.sourceModel && !this.isDrawing) {
            this.viewer.toolController.activateTool(this.snapper.getName());
            this.viewer.toolController.activateTool(this.getName());
        }
    }

    deactivateDrawing() {
        if (this.isDrawing) {
            this.viewer.toolController.deactivateTool(this.getName());
            this.viewer.toolController.deactivateTool(this.snapper.getName());
        }
    }

    undo() {
        this.endChain();
        const wall = this.walls.pop();
        if (wall) {
            this.removeInstance(wall.instanceId);
            this.onChange();
        }
    }

    clear() {
        this.endChain();
        for (const wall of this.walls) {
            this.removeInstance(wall.instanceId);
        }
        this.walls = [];
        this.onChange();
    }

    // Walls in the source model's own coordinates: the viewer subtracts a global offset when loading models.
    getWalls() {
        const offset = this.sourceModel?.getData().globalOffset || { x: 0, y: 0, z: 0 };
        const toModel = p => ({ x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z });
        return this.walls.map(w => ({ start: toModel(w.start), end: toModel(w.end), height: w.height, thickness: w.thickness }));
    }

    getUnits() {
        return this.sourceModel?.getUnitString?.() || 'ft';
    }

    // --- Viewer ToolInterface ---

    getNames() { return this.names; }
    getName() { return this.names[0]; }
    getPriority() { return 10; }
    activate() { this.onChange(); return true; }
    deactivate() { this.endChain(); this.snapper.indicator.clearOverlays(); this.onChange(); return true; }
    update() { return false; }

    handleSingleClick(event, button) {
        if (button !== 0) {
            this.endChain();
            return true;
        }
        const point = this.snap(event);
        if (point) {
            if (!this.start) {
                this.start = point;
            } else {
                const wall = this.makeWall(this.start, point);
                if (wall) {
                    wall.instanceId = this.instances.add(createWallGeometry(wall), this.wallMaterial, new avm.Matrix4());
                    this.walls.push(wall);
                    this.start = wall.end; // chain walls end to start
                    this.onChange();
                }
            }
        }
        this.viewer.refresh(true);
        return true;
    }

    handleDoubleClick() { return true; }

    handleMouseMove(event) {
        const point = this.snap(event);
        const wall = this.start && point && this.makeWall(this.start, point);
        if (wall) {
            this.previewId = this.instances.add(createWallGeometry(wall), this.previewMaterial, new avm.Matrix4());
        }
        this.viewer.refresh(true);
        return false; // let navigation tools see the event too
    }

    handleKeyDown(event, keyCode) {
        if (keyCode === ESCAPE_KEY) {
            this.endChain();
            return true;
        }
        return false;
    }

    // --- helpers ---

    makeWall(start, point) {
        // Keep walls horizontal: the end point uses the start elevation.
        const end = { x: point.x, y: point.y, z: start.z };
        if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6 || this.height <= 0 || this.thickness <= 0) {
            return null;
        }
        return { start, end, height: this.height, thickness: this.thickness };
    }

    /**
     * Returns the snapped point under the cursor and draws the snap indicator.
     * The preview wall is removed first: the snapper ray-casts against every visible model,
     * so it would otherwise snap onto the preview itself.
     */
    snap(event) {
        this.clearPreview();
        const snapper = this.snapper;
        snapper.indicator.clearOverlays();
        snapper.onMouseMove({ x: event.canvasX, y: event.canvasY });
        if (snapper.isSnapped()) {
            const result = snapper.getSnapResult();
            snapper.indicator.render();
            const point = isPointSnap(result.geomType) ? result.geomVertex : result.intersectPoint;
            if (point) {
                return { x: point.x, y: point.y, z: point.z };
            }
        }
        // Nothing to snap to: fall back to a plain hit test on the loaded model.
        const hit = this.viewer.impl.hitTest(event.canvasX, event.canvasY, false, null, [this.sourceModel.getModelId()]);
        return hit?.point ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null;
    }

    endChain() {
        this.start = null;
        this.clearPreview();
        this.viewer.refresh(true);
    }

    clearPreview() {
        if (this.previewId >= 0) {
            this.removeInstance(this.previewId);
            this.previewId = -1;
        }
    }

    removeInstance(id) {
        if (id === undefined || id < 0 || !this.instances) {
            return;
        }
        this.instances.remove(id);
        this.viewer.refresh(true);
    }
}
