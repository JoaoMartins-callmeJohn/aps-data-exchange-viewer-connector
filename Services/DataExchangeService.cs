using System.Collections.Concurrent;
using Autodesk.DataExchange;
using Autodesk.DataExchange.Core.Enums;
using Autodesk.DataExchange.Core.Interface;
using Autodesk.DataExchange.Core.Models;
using Autodesk.DataExchange.DataModels;
using Autodesk.DataExchange.Extensions.HostingProvider;
using Autodesk.DataExchange.Extensions.Logging.File;
using Autodesk.DataExchange.Extensions.Storage.File;
using Autodesk.DataExchange.Interface;
using Autodesk.DataExchange.Models;
using Autodesk.DataExchange.SchemaObjects.Units;
using Autodesk.GeometryUtilities.MeshAPI;
using Autodesk.Parameters;
using Color = Autodesk.GeometryUtilities.PrimitivesAPI.Color;
using Mesh = Autodesk.GeometryUtilities.MeshAPI.Mesh;

public record SavedElement(string Name, Dictionary<string, string> Parameters);
public record WallsExchangeResult(string Name, string ExchangeId, string CollectionId, string HubId, string FileUrn, List<SavedElement> SavedElements);

/// <summary>
/// Creates Data Exchanges containing walls drawn in the viewer.
/// One SDK client is kept per signed-in user because constructing a Client starts the SDK's helper services.
/// </summary>
public class DataExchangeService
{
    private const string ConnectorName = "APS-DX-Walls";
    private static readonly string AppBasePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), ConnectorName);

    private readonly ConcurrentDictionary<string, (Client Client, WebSessionAuth Auth)> _clients = new();
    private readonly ILogger<DataExchangeService> _logger;

    public DataExchangeService(ILogger<DataExchangeService> logger)
    {
        _logger = logger;
    }

    public async Task<WallsExchangeResult> CreateWallsExchange(string userId, string accessToken, CreateWallsExchangeRequest request)
    {
        var client = GetClient(userId, accessToken);

        var created = await client.CreateExchangeAsync(new ExchangeCreateRequestACC
        {
            Host = client.SDKOptions.HostingProvider,
            Contract = new Autodesk.DataExchange.ContractProvider.ContractProvider(),
            Description = "Walls drawn in the APS Viewer",
            FileName = request.Name,
            HubId = request.HubId,
            ACCFolderURN = request.FolderId,
            ProjectId = request.ProjectId,
            ProjectType = ProjectType.ACC,
        });
        ThrowIfFailed(created, "create the exchange");

        var identifier = new DataExchangeIdentifier
        {
            CollectionId = created.Value.CollectionID,
            ExchangeId = created.Value.ExchangeID,
            HubId = created.Value.HubId,
        };

        var unit = ToUnit(request.Units);
        var units = new Units(unit, unit, UnitFactory.Radian);
        var unitLabel = string.IsNullOrEmpty(request.Units) ? "ft" : request.Units;
        var (r, g, b) = ParseColor(request.Color);
        // Fully opaque: alpha 255 on the color and transparency 0 on the style.
        var style = new RenderStyle($"Wall {request.Color}", new RGBA(r, g, b, 255), 0.0);
        var meshColor = new Color(r, g, b, 255);

        IElementDataModel model = ElementDataModel.Create(client);
        for (var i = 0; i < request.Walls.Count; i++)
        {
            var wall = request.Walls[i];
            var sourceId = $"wall-{i + 1:000}";
            var element = model.AddElement(sourceId, $"Wall {i + 1}");
            var category = model.Classify(element, ClassificationSystem.Category, "Walls");
            var family = model.Classify(element, ClassificationSystem.Family, "Basic Wall", parent: category);
            model.SetType(element, model.DefineType(system: "Type", name: $"Generic - {wall.Thickness:0.###} {unitLabel}", parent: family));

            var mesh = BuildWallMesh(wall);
            // MeshColor is null by default; set it (and each face color) so the chosen color is what consumers render.
            mesh.MeshColor = meshColor;
            foreach (var face in mesh.Faces) face.FaceColor = meshColor;
            var geometry = ElementDataModel.CreateMeshGeometry(mesh, "Wall", units, sourceId);
            geometry.RenderStyle = style;
            model.SetElementGeometry(element, new List<IElementGeometry> { geometry });

            // Custom instance parameters, as in the official aps-dataexchange-console sample
            // (ParameterSampleHelper.CreateCustomParameter). Values are in the source model's units.
            var length = WallLength(wall);
            var dimensions = Group.Dimensions.DisplayName();
            var general = Group.General.DisplayName();
            await AddParameter(element, "Length", length, dimensions);
            await AddParameter(element, "Width", wall.Thickness, dimensions);
            await AddParameter(element, "Height", wall.Height, dimensions);
            await AddParameter(element, "Area", length * wall.Height, dimensions);
            await AddParameter(element, "Volume", length * wall.Height * wall.Thickness, dimensions);
            await AddParameter(element, "Units", unitLabel, general);
            await AddParameter(element, "Color", request.Color, general);
        }

        var sync = await client.SyncExchangeDataAsync(identifier, model);
        ThrowIfFailed(sync, "sync the walls to the exchange");

        // Read the latest revision back so the caller can see what was actually persisted.
        var loaded = await client.GetElementDataModelAsync(identifier, loadLatest: true);
        ThrowIfFailed(loaded, "read the exchange back");
        var saved = loaded.Value.Elements
            .Select(e => new SavedElement(e.Name, FlattenParameters(e.InstanceParameters)))
            .ToList();
        foreach (var element in saved)
        {
            _logger.LogInformation("Exchange {ExchangeId}: {Element} has {Count} instance parameters: {Parameters}",
                identifier.ExchangeId, element.Name, element.Parameters.Count, string.Join(", ", element.Parameters.Keys));
        }

        return new WallsExchangeResult(request.Name, identifier.ExchangeId, identifier.CollectionId, identifier.HubId, created.Value.FileUrn, saved);
    }

    private Client GetClient(string userId, string accessToken)
    {
        var entry = _clients.GetOrAdd(userId, id =>
        {
            var auth = new WebSessionAuth(accessToken);
            var userPath = Path.Combine(AppBasePath, "users", id);
            Directory.CreateDirectory(userPath);
            var log = new Log(Path.Combine(AppBasePath, "logs"));
            var options = new SDKOptions
            {
                AuthProvider = auth,
                Storage = new Storage(userPath, log),
                HostingProvider = new ACC(log, () => auth.GetAuthToken()),
                SourceProvider = new Autodesk.DataExchange.SourceProvider.SourceProvider(),
                ContractProvider = new Autodesk.DataExchange.ContractProvider.ContractProvider(),
                Logger = log,
                ConnectorName = ConnectorName,
                ConnectorVersion = "1.0.0",
                HostApplicationName = "APS Viewer",
                HostApplicationVersion = "7",
            };
            _logger.LogInformation("Creating Data Exchange client for user {UserId}", id);
            return (new Client(options), auth);
        });
        entry.Auth.UpdateToken(accessToken);
        return entry.Client;
    }

    private static async Task AddParameter(IElement element, string name, ParameterDataType value, string groupId)
    {
        var created = await element.CreateInstanceParameterAsync(new Parameter(name, value)
        {
            IsCustomParameter = true,
            SampleText = string.Empty,
            Description = string.Empty,
            ReadOnly = false,
            GroupID = groupId,
        });
        if (created == null)
        {
            throw new InvalidOperationException($"Could not add parameter '{name}' to {element.Name}.");
        }
    }

    // Instance parameters may be nested in ParameterSets.
    private static Dictionary<string, string> FlattenParameters(IEnumerable<IParameter> parameters)
    {
        var result = new Dictionary<string, string>();
        void Visit(IParameter parameter)
        {
            if (parameter is ParameterSet set)
            {
                foreach (var child in set.Parameters) Visit(child);
            }
            else
            {
                result[parameter.Name ?? parameter.SchemaId] = parameter.Value?.ToString() ?? string.Empty;
            }
        }
        foreach (var parameter in parameters) Visit(parameter);
        return result;
    }

    private static double WallLength(WallDto wall)
    {
        var dx = wall.End.X - wall.Start.X;
        var dy = wall.End.Y - wall.Start.Y;
        return Math.Sqrt(dx * dx + dy * dy);
    }

    /// <summary>
    /// Builds a box from the wall's base line (start → end, at the start Z), extruded along +Z.
    /// Mirrors buildWallBox in wwwroot/walls.js: 24 vertices (4 per face) so each face gets its own normal.
    /// </summary>
    private static Mesh BuildWallMesh(WallDto wall)
    {
        var length = WallLength(wall);
        var dirX = (wall.End.X - wall.Start.X) / length;
        var dirY = (wall.End.Y - wall.Start.Y) / length;
        var offX = -dirY * wall.Thickness / 2;
        var offY = dirX * wall.Thickness / 2;
        double z0 = wall.Start.Z, z1 = wall.Start.Z + wall.Height;

        // Base corners: a/b on the start side, c/d on the end side.
        double[] a = { wall.Start.X + offX, wall.Start.Y + offY };
        double[] b = { wall.Start.X - offX, wall.Start.Y - offY };
        double[] c = { wall.End.X - offX, wall.End.Y - offY };
        double[] d = { wall.End.X + offX, wall.End.Y + offY };
        Vertex V(double[] p, double z) => new Vertex(p[0], p[1], z);

        var nx = offX / (wall.Thickness / 2);
        var ny = offY / (wall.Thickness / 2);
        var quads = new (Vertex[] Corners, Normal Normal)[]
        {
            (new[] { V(b, z0), V(a, z0), V(d, z0), V(c, z0) }, new Normal(0, 0, -1)),   // bottom
            (new[] { V(a, z1), V(b, z1), V(c, z1), V(d, z1) }, new Normal(0, 0, 1)),    // top
            (new[] { V(a, z0), V(b, z0), V(b, z1), V(a, z1) }, new Normal(-dirX, -dirY, 0)), // start cap
            (new[] { V(c, z0), V(d, z0), V(d, z1), V(c, z1) }, new Normal(dirX, dirY, 0)),   // end cap
            (new[] { V(d, z0), V(a, z0), V(a, z1), V(d, z1) }, new Normal(nx, ny, 0)),   // side +offset
            (new[] { V(b, z0), V(c, z0), V(c, z1), V(b, z1) }, new Normal(-nx, -ny, 0)), // side -offset
        };

        var mesh = new Mesh { Vertices = new List<Vertex>(), Faces = new List<Face>() };
        foreach (var (corners, normal) in quads)
        {
            var i = mesh.Vertices.Count;
            mesh.Vertices.AddRange(corners);
            var normals = new List<Normal> { normal, normal, normal };
            mesh.Faces.Add(new Face { Corners = new List<int> { i, i + 1, i + 2 }, Normals = normals });
            mesh.Faces.Add(new Face { Corners = new List<int> { i, i + 2, i + 3 }, Normals = new List<Normal>(normals) });
        }
        return mesh;
    }

    private static (ushort R, ushort G, ushort B) ParseColor(string? hex)
    {
        var value = (hex ?? string.Empty).TrimStart('#');
        if (value.Length != 6 || !int.TryParse(value, System.Globalization.NumberStyles.HexNumber, null, out var rgb))
        {
            rgb = 0xc8c8c8;
        }
        return ((ushort)((rgb >> 16) & 0xff), (ushort)((rgb >> 8) & 0xff), (ushort)(rgb & 0xff));
    }

    private static Unit ToUnit(string? units) => units?.ToLowerInvariant() switch
    {
        "m" => UnitFactory.Meter,
        "cm" => UnitFactory.Centimeter,
        "mm" => UnitFactory.MilliMeter,
        "in" => UnitFactory.Inches,
        "ft-and-fractional-in" or "ft-and-decimal-in" or "decimal-ft" or "ft" or null or "" => UnitFactory.Feet,
        "decimal-in" or "fractional-in" => UnitFactory.Inches,
        _ => UnitFactory.Feet,
    };

    private static void ThrowIfFailed<T>(IResponse<T> response, string action)
    {
        if (response.IsFailed)
        {
            throw new InvalidOperationException($"Could not {action}: {string.Join("; ", response.Errors.Select(e => e.Message))}");
        }
    }
}
