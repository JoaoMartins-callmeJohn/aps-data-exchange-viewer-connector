async function getJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        alert('Could not load tree data. See console for more details.');
        console.error(await resp.text());
        return [];
    }
    return resp.json();
}

function createTreeNode(id, text, icon, children = false) {
    return { id, text, children, itree: { icon } };
}

async function getHubs() {
    const hubs = await getJSON('/api/hubs');
    return hubs.map(hub => createTreeNode(`hub|${hub.id}`, hub.name, 'icon-hub', true));
}

async function getProjects(hubId) {
    const projects = await getJSON(`/api/hubs/${hubId}/projects`);
    return projects.map(project => createTreeNode(`project|${hubId}|${project.id}`, project.name, 'icon-project', true));
}

async function getContents(hubId, projectId, folderId = null) {
    const contents = await getJSON(`/api/hubs/${hubId}/projects/${projectId}/contents` + (folderId ? `?folder_id=${folderId}` : ''));
    return contents.map(item => {
        if (item.folder) {
            return createTreeNode(`folder|${hubId}|${projectId}|${item.id}`, item.name, 'icon-my-folder', true);
        } else {
            // Keep the parent folder in the node id: the new exchange is created next to the input file.
            return createTreeNode(`item|${hubId}|${projectId}|${folderId}|${item.id}`, item.name, 'icon-item', true);
        }
    });
}

async function getVersions(hubId, projectId, folderId, itemId) {
    const versions = await getJSON(`/api/hubs/${hubId}/projects/${projectId}/contents/${itemId}/versions`);
    return versions.map(version => createTreeNode(`version|${hubId}|${projectId}|${folderId}|${version.id}`, version.name, 'icon-version'));
}

export function initTree(selector, onSelectionChanged) {
    // See http://inspire-tree.com
    const tree = new InspireTree({
        data: function (node) {
            if (!node || !node.id) {
                return getHubs();
            } else {
                const tokens = node.id.split('|');
                switch (tokens[0]) {
                    case 'hub': return getProjects(tokens[1]);
                    case 'project': return getContents(tokens[1], tokens[2]);
                    case 'folder': return getContents(tokens[1], tokens[2], tokens[3]);
                    case 'item': return getVersions(tokens[1], tokens[2], tokens[3], tokens[4]);
                    default: return [];
                }
            }
        }
    });
    tree.on('node.click', function (event, node) {
        event.preventTreeDefault();
        const tokens = node.id.split('|');
        if (tokens[0] === 'version') {
            onSelectionChanged({ hubId: tokens[1], projectId: tokens[2], folderId: tokens[3], versionId: tokens[4] });
        }
    });
    return new InspireTreeDOM(tree, { target: selector });
}
