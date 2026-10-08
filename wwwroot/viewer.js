async function getAccessToken(callback) {
    try {
        const resp = await fetch('/api/auth/token');
        if (!resp.ok)
            throw new Error(await resp.text());
        const { access_token, expires_in } = await resp.json();
        callback(access_token, expires_in);
    } catch (err) {
        alert('Could not obtain access token. See the console for more details.');
        console.error(err);
    }
}

export function initViewer(container) {
    return new Promise(function (resolve, reject) {
        Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, function () {
            const config = {
                extensions: ['Autodesk.DocumentBrowser']
            };
            const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
            viewer.start();
            viewer.setTheme('light-theme');
            resolve(viewer);
        });
    });
}

// Resolves with the loaded model once its geometry is fully available (needed for hit-testing and units).
export function loadModel(viewer, urn) {
    return new Promise(function (resolve, reject) {
        function onDocumentLoadSuccess(doc) {
            for (const model of viewer.getAllModels()) {
                viewer.unloadModel(model);
            }
            viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry())
                .then(model => {
                    if (model.isLoadDone()) {
                        resolve(model);
                    } else {
                        viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, function onLoaded(ev) {
                            if (ev.model === model) {
                                viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded);
                                resolve(model);
                            }
                        });
                    }
                })
                .catch(reject);
        }
        function onDocumentLoadFailure(code, message) {
            alert('Could not load model. See console for more details.');
            console.error(message);
            reject(new Error(message));
        }
        Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
    });
}
