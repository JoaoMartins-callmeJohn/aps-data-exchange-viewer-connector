using Autodesk.Authentication.Model;

public class Tokens
{
    public string InternalToken = string.Empty;
    public string PublicToken = string.Empty;
    public string RefreshToken = string.Empty;
    public DateTime ExpiresAt;
}

public partial class APS
{
    private readonly string _clientId;
    private readonly string _clientSecret;
    private readonly string _callbackUri;
    // The internal token is also handed to the Data Exchange SDK, so it needs write/create scopes.
    private readonly List<Scopes> InternalTokenScopes = [Scopes.DataRead, Scopes.DataWrite, Scopes.DataCreate, Scopes.ViewablesRead];
    private readonly List<Scopes> PublicTokenScopes = [Scopes.ViewablesRead];

    public APS(string clientId, string clientSecret, string callbackUri)
    {
        _clientId = clientId;
        _clientSecret = clientSecret;
        _callbackUri = callbackUri;
    }
}
