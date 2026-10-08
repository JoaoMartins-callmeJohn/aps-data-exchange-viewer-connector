# aps-data-exchange-viewer-connector
Sample Data Exchange connector from the Autodesk Viewer created using Agent Skills

Browse your Autodesk Forma hubs, load a file version in the APS Viewer, draw walls on top of it with the
[Viewer Scene API](https://aps.autodesk.com/blog/introducing-scene-api-aps-viewer), and submit them as a new
**Data Exchange** in the same folder as the input file, using the
[Data Exchange .NET SDK](https://aps.autodesk.com/en/docs/dx-sdk/v8.0.0/developers_guide/overview/) 8.0.0.

The hubs/projects/folders browsing experience is based on
[aps-hubs-browser-dotnet](https://github.com/autodesk-platform-services/aps-hubs-browser-dotnet).

## How it works

- **Server (.NET 8, `net8.0-windows`, x64)**
  - `Controllers/AuthController.cs`: 3-legged OAuth, with tokens kept in cookies (same as the hubs browser).
  - `Controllers/HubsController.cs`: hubs, projects, folders, items and versions through Data Management.
  - `Controllers/ExchangesController.cs`: `POST /api/exchanges` takes the drawn walls and the target hub, project and folder.
  - `Services/DataExchangeService.cs`: creates the exchange with `CreateExchangeAsync(ExchangeCreateRequestACC)`. It builds an `ElementDataModel` with one element per wall: category *Walls*, family *Basic Wall*, a type, a box mesh, and Length/Height/Thickness parameters. Then it calls `SyncExchangeDataAsync`.
  - `Services/WebSessionAuth.cs`: an `IAuth` implementation that hands the web session's access token to the SDK. The SDK's default auth would open a desktop browser instead.
- **Client (vanilla JS, `wwwroot/`)**
  - `sidebar.js`: InspireTree browser. Node ids carry the parent folder of each item.
  - `viewer.js`: Viewer initialization and model loading.
  - `walls.js`: the `WallTool` viewer tool. It renders walls as Scene API instances (`Autodesk.Viewing.Model` → `getInstances()` → `add(BufferGeometry, StandardMaterial, Matrix4)`).
  - `main.js`: wires everything together.

## Prerequisites

- Windows x64. The Data Exchange SDK is Windows only and copies its native helper services (`ParameterService/`, `GeometryUtilitiesService/`, about 540 MB) into the build output.
- [.NET 8 SDK](https://dotnet.microsoft.com/download).
- An [APS application](https://aps.autodesk.com/myapps):
  - The **Data Management** and **Data Exchange** APIs enabled.
  - Callback URL `http://localhost:8080/api/auth/callback`.
  - Access to the Forma (ACC) account you want to use: an account admin must add the app's client ID under *Custom Integrations*.

## Running locally

```bash
# PowerShell: $env:APS_CLIENT_ID="..."; $env:APS_CLIENT_SECRET="..."
export APS_CLIENT_ID="<your client id>"
export APS_CLIENT_SECRET="<your client secret>"
# optional, defaults to http://localhost:8080/api/auth/callback
export APS_CALLBACK_URL="http://localhost:8080/api/auth/callback"

dotnet run
```

Open http://localhost:8080, log in, then:

1. Expand a hub → project → folder → file and click a **version** to load it.
2. Set the wall **Height** and **Thickness**. They are in the model's units, and the defaults are 3 m and 0.2 m converted to those units.
3. Click **Draw walls**, then click two points on the model to create a wall. Walls chain from one to the next; press Esc or right-click to start a new chain. **Undo** and **Clear** remove walls.
4. Enter an exchange name and click **Submit as new exchange**. The exchange appears in the same folder as the input file.

SDK logs and per-user SDK storage are written to `%LOCALAPPDATA%\APS-DX-Walls`.

## Limitations

- Walls are horizontal. The base sits at the elevation of the first picked point, and the wall extrudes along +Z.
- Picked points are converted back to the source model's coordinates by adding the viewer's global offset only. Models loaded with an extra placement or reference-point transform (for example some Revit shared-coordinate setups) may need additional handling.
- One SDK `Client` is cached per signed-in user for the lifetime of the server process.

## License

This sample is licensed under the terms of the [MIT License](LICENSE).
