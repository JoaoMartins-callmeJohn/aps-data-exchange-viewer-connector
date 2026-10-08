using Autodesk.Authentication;
using Autodesk.DataExchange.Core.Interface;
using Autodesk.DataExchange.Core.Models;

/// <summary>
/// Bridges the web app's 3-legged session token to the Data Exchange SDK.
/// The SDK's own Auth class opens a desktop browser on a localhost port, which does not work for a web server,
/// so we hand it the token the user already obtained through /api/auth/callback instead.
/// </summary>
public class WebSessionAuth : IAuth
{
    private volatile string _token;

    public WebSessionAuth(string token)
    {
        _token = token;
    }

    public void UpdateToken(string token) => _token = token;

    // The web session owns token refresh (see AuthController.PrepareTokens), so isForceRefresh is ignored here.
    public string GetAuthToken(bool isForceRefresh = false) => _token;

    public Task<string> GetAuthTokenAsync() => Task.FromResult(_token);

    public async Task<UserAccount> GetUserAccountAsync()
    {
        var userInfo = await new AuthenticationClient().GetUserInfoAsync(_token);
        return new UserAccount
        {
            UserId = userInfo.Sub,
            Email = userInfo.Email,
            FirstName = userInfo.GivenName,
            LastName = userInfo.FamilyName,
            ThumbnailURL = userInfo.Picture
        };
    }
}
