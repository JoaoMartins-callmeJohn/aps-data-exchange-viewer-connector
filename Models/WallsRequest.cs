public class Point3
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Z { get; set; }
}

public class WallDto
{
    public Point3 Start { get; set; } = new();
    public Point3 End { get; set; } = new();
    public double Height { get; set; }
    public double Thickness { get; set; }
}

public class CreateWallsExchangeRequest
{
    public string HubId { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string FolderId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    // Unit string reported by the viewer model (e.g. "ft", "m", "mm").
    public string Units { get; set; } = "ft";
    public List<WallDto> Walls { get; set; } = new();
}
