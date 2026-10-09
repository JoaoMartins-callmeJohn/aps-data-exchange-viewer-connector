var builder = WebApplication.CreateBuilder(args);

var clientID = builder.Configuration["APS_CLIENT_ID"];
var clientSecret = builder.Configuration["APS_CLIENT_SECRET"];
var callbackURL = builder.Configuration["APS_CALLBACK_URL"] ?? "http://localhost:8080/api/auth/callback";
if (string.IsNullOrEmpty(clientID) || string.IsNullOrEmpty(clientSecret))
{
    throw new ApplicationException("Missing required environment variables APS_CLIENT_ID or APS_CLIENT_SECRET.");
}

builder.WebHost.UseUrls(builder.Configuration["ASPNETCORE_URLS"] ?? "http://localhost:8080");
builder.Services.AddControllers();
builder.Services.AddSingleton(new APS(clientID, clientSecret, callbackURL));
builder.Services.AddSingleton<DataExchangeService>();

var app = builder.Build();
if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}
app.UseDefaultFiles();
// Always revalidate the client scripts so changes are picked up without a hard refresh.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache"
});
app.MapControllers();
app.Run();
