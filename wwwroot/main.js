import { initViewer, loadModel } from './viewer.js';
import { initTree } from './sidebar.js';
import { WallTool } from './walls.js';

// Meters per viewer unit string, used to pick sensible default wall dimensions.
const METERS_PER_UNIT = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, 'decimal-ft': 0.3048, 'ft-and-fractional-in': 0.3048, 'ft-and-decimal-in': 0.3048, in: 0.0254, 'decimal-in': 0.0254, 'fractional-in': 0.0254 };

const login = document.getElementById('login');
try {
    const resp = await fetch('/api/auth/profile');
    if (resp.ok) {
        const user = await resp.json();
        login.innerText = `Logout (${user.name})`;
        login.onclick = () => {
            const iframe = document.createElement('iframe');
            iframe.style.visibility = 'hidden';
            iframe.src = 'https://accounts.autodesk.com/Authentication/LogOut';
            document.body.appendChild(iframe);
            iframe.onload = () => {
                window.location.replace('/api/auth/logout');
                document.body.removeChild(iframe);
            };
        }
        const viewer = await initViewer(document.getElementById('preview'));
        await viewer.loadExtension('Autodesk.Snapping');
        const wallTool = new WallTool(viewer);
        const panel = initWallsPanel(wallTool);
        initTree('#tree', async (context) => {
            panel.disable('Loading model...');
            try {
                const model = await loadModel(viewer, window.btoa(context.versionId).replace(/=/g, ''));
                wallTool.attach(model);
                panel.enable(context, wallTool.getUnits());
            } catch (err) {
                panel.disable('Could not load the model.');
                console.error(err);
            }
        });
    } else {
        login.innerText = 'Login';
        login.onclick = () => window.location.replace('/api/auth/login');
    }
    login.style.visibility = 'visible';
} catch (err) {
    alert('Could not initialize the application. See console for more details.');
    console.error(err);
}

function initWallsPanel(wallTool) {
    const panel = document.getElementById('walls-panel');
    const hint = document.getElementById('walls-hint');
    const status = document.getElementById('walls-status');
    const heightInput = document.getElementById('wall-height');
    const thicknessInput = document.getElementById('wall-thickness');
    const colorInput = document.getElementById('wall-color');
    const drawButton = document.getElementById('draw-walls');
    const undoButton = document.getElementById('undo-wall');
    const clearButton = document.getElementById('clear-walls');
    const nameInput = document.getElementById('exchange-name');
    const submitButton = document.getElementById('submit-walls');
    let context = null;
    let units = 'ft';

    function setStatus(text, isError = false) {
        status.innerText = text;
        status.classList.toggle('error', isError);
    }

    function syncDimensions() {
        wallTool.height = parseFloat(heightInput.value) || 0;
        wallTool.thickness = parseFloat(thicknessInput.value) || 0;
    }

    wallTool.onChange = () => {
        drawButton.classList.toggle('active', wallTool.isDrawing);
        drawButton.innerText = wallTool.isDrawing ? 'Stop drawing' : 'Draw walls';
        const count = wallTool.walls.length;
        if (context) {
            hint.innerText = wallTool.isDrawing
                ? `Click two points on the model to draw a wall (walls chain; Esc or right-click ends the chain). ${count} wall(s) drawn.`
                : `${count} wall(s) drawn. Click "Draw walls" to add more.`;
        }
        submitButton.disabled = count === 0;
        undoButton.disabled = clearButton.disabled = count === 0;
    };

    heightInput.onchange = syncDimensions;
    thicknessInput.onchange = syncDimensions;
    colorInput.oninput = () => wallTool.setColor(colorInput.value);
    drawButton.onclick = () => {
        syncDimensions();
        if (wallTool.isDrawing) wallTool.deactivateDrawing(); else wallTool.activateDrawing();
    };
    undoButton.onclick = () => wallTool.undo();
    clearButton.onclick = () => wallTool.clear();
    submitButton.onclick = async () => {
        if (!context) return;
        wallTool.deactivateDrawing();
        submitButton.disabled = true;
        setStatus('Creating the exchange and syncing walls. This can take a minute...');
        try {
            const resp = await fetch('/api/exchanges', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hubId: context.hubId,
                    projectId: context.projectId,
                    folderId: context.folderId,
                    name: nameInput.value,
                    units,
                    color: wallTool.color,
                    walls: wallTool.getWalls()
                })
            });
            const result = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                throw new Error(result.message || `Request failed with status ${resp.status}`);
            }
            const saved = (result.savedElements || [])
                .map(e => `${e.name}: ${Object.entries(e.parameters).map(([k, v]) => `${k}=${v}`).join(', ') || 'no properties'}`)
                .join('\n');
            setStatus(`Exchange "${result.name}" created in the input file's folder (exchange id: ${result.exchangeId}).\nSaved:\n${saved}`);
        } catch (err) {
            setStatus(`Could not create the exchange: ${err.message}`, true);
            console.error(err);
        } finally {
            submitButton.disabled = wallTool.walls.length === 0;
        }
    };

    return {
        enable(ctx, modelUnits) {
            context = ctx;
            units = modelUnits;
            const metersPerUnit = METERS_PER_UNIT[units] || METERS_PER_UNIT.ft;
            const round = v => Math.round(v * 1000) / 1000;
            heightInput.value = round(3 / metersPerUnit);
            thicknessInput.value = round(0.2 / metersPerUnit);
            for (const label of panel.querySelectorAll('.unit')) label.innerText = units;
            nameInput.value = `Walls ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-')}`;
            syncDimensions();
            wallTool.setColor(colorInput.value);
            setStatus('');
            panel.classList.remove('disabled');
            wallTool.onChange();
        },
        disable(message) {
            context = null;
            panel.classList.add('disabled');
            hint.innerText = message;
            setStatus('');
        }
    };
}
