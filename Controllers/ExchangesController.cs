using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class ExchangesController : ControllerBase
{
    private static readonly Regex InvalidNameChars = new(@"[^a-zA-Z0-9 (){}\[\]~_-]");

    private readonly APS _aps;
    private readonly DataExchangeService _dataExchange;
    private readonly ILogger<ExchangesController> _logger;

    public ExchangesController(APS aps, DataExchangeService dataExchange, ILogger<ExchangesController> logger)
    {
        _aps = aps;
        _dataExchange = dataExchange;
        _logger = logger;
    }

    [HttpPost()]
    public async Task<ActionResult> CreateWallsExchange([FromBody] CreateWallsExchangeRequest request)
    {
        var tokens = await AuthController.PrepareTokens(Request, Response, _aps);
        if (tokens == null)
        {
            return Unauthorized();
        }
        if (string.IsNullOrEmpty(request.HubId) || string.IsNullOrEmpty(request.ProjectId) || string.IsNullOrEmpty(request.FolderId))
        {
            return BadRequest(new { message = "hubId, projectId and folderId are required." });
        }
        if (request.Walls.Count == 0)
        {
            return BadRequest(new { message = "Draw at least one wall before submitting." });
        }
        if (request.Walls.Any(w => w.Height <= 0 || w.Thickness <= 0 || (w.Start.X == w.End.X && w.Start.Y == w.End.Y)))
        {
            return BadRequest(new { message = "Every wall needs a positive height and thickness and two distinct points." });
        }
        // Exchange names must match ^[a-zA-Z0-9 (){}\[\]~_-]+$
        request.Name = InvalidNameChars.Replace(request.Name ?? string.Empty, "_").Trim();
        if (string.IsNullOrEmpty(request.Name))
        {
            request.Name = $"Walls {DateTime.Now:yyyy-MM-dd HH-mm-ss}";
        }

        try
        {
            var profile = await _aps.GetUserProfile(tokens);
            var result = await _dataExchange.CreateWallsExchange(profile.Sub, tokens.InternalToken, request);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create walls exchange");
            return BadRequest(new { message = ex.Message });
        }
    }
}
