using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using mydb_putty_101.Contracts;

namespace mydb_putty_101.Services;

public class VeoProviderService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<VeoProviderService> _logger;
    private readonly string _baseUrl;
    private readonly string _apiKey;

    public VeoProviderService(IHttpClientFactory httpClientFactory, IConfiguration configuration, ILogger<VeoProviderService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _baseUrl = (configuration["Providers:Google:BaseUrl"]
            ?? configuration["Providers:Veo:BaseUrl"]
            ?? "https://generativelanguage.googleapis.com").TrimEnd('/');
        _apiKey = Environment.GetEnvironmentVariable("GOOGLE_API_KEY")
            ?? configuration["Providers:Google:ApiKey"]
            ?? configuration["Providers:Veo:ApiKey"]
            ?? string.Empty;
    }

    public async Task<List<string>> CreateOperationsAsync(JobRecord job, string? uploadedImagePath, string? referenceImagePath, CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        var prompts = SplitPrompts(job.Prompt, expectedCount: job.ResultCount);
        var operations = new List<string>();

        foreach (var prompt in prompts)
        {
            var instance = new Dictionary<string, object?>
            {
                ["prompt"] = prompt
            };

            if (!string.IsNullOrWhiteSpace(uploadedImagePath) && File.Exists(uploadedImagePath))
            {
                instance["image"] = BuildInlineData(uploadedImagePath);
            }

            if (!string.IsNullOrWhiteSpace(referenceImagePath) && File.Exists(referenceImagePath))
            {
                instance["referenceImages"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["image"] = BuildInlineData(referenceImagePath),
                        ["referenceType"] = "asset"
                    }
                };
            }

            var payload = new Dictionary<string, object?>
            {
                ["instances"] = new[] { instance },
                ["parameters"] = new Dictionary<string, object?>
                {
                    ["aspectRatio"] = NormalizeAspectRatio(job.AspectRatio),
                    ["durationSeconds"] = NormalizeDuration(job.Duration)
                }
            };

            var url = $"{_baseUrl}/v1beta/models/{NormalizeVideoModel(job.Model)}:predictLongRunning";
            var responseJson = await SendJsonAsync(HttpMethod.Post, url, payload, cancellationToken);
            var operationName = responseJson.RootElement.TryGetProperty("name", out var nameEl) ? nameEl.GetString() : null;

            if (string.IsNullOrWhiteSpace(operationName))
            {
                throw new InvalidOperationException("Google Veo không trả về operation name.");
            }

            operations.Add(operationName!);
        }

        return operations;
    }

    public async Task<ProviderPollResult> PollOperationsAsync(IEnumerable<string> operationNames, CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        var operations = operationNames.Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
        if (operations.Count == 0)
        {
            return new ProviderPollResult { Status = "FAILED", ErrorMessage = "Không có operation để poll từ Google Veo." };
        }

        var assets = new List<ProviderAsset>();
        foreach (var op in operations)
        {
            var cleanOp = op.TrimStart('/');
            var path = cleanOp.StartsWith("v1beta/", StringComparison.OrdinalIgnoreCase) ? cleanOp : $"v1beta/{cleanOp}";
            var url = $"{_baseUrl}/{path}";
            var statusJson = await SendJsonAsync(HttpMethod.Get, url, null, cancellationToken);
            var root = statusJson.RootElement;

            if (root.TryGetProperty("done", out var doneEl) && doneEl.ValueKind == JsonValueKind.True)
            {
                if (root.TryGetProperty("error", out var errorEl))
                {
                    return new ProviderPollResult
                    {
                        Status = "FAILED",
                        ErrorMessage = errorEl.ToString()
                    };
                }

                var videoUri = ExtractVideoUri(root);
                if (string.IsNullOrWhiteSpace(videoUri))
                {
                    return new ProviderPollResult
                    {
                        Status = "FAILED",
                        ErrorMessage = "Google Veo hoàn tất nhưng không trả về video URI."
                    };
                }

                var bytes = await DownloadBytesAsync(videoUri!, cancellationToken);
                assets.Add(new ProviderAsset
                {
                    Type = "video",
                    Bytes = bytes,
                    MimeType = "video/mp4",
                    SuggestedExtension = ".mp4",
                    Title = "Google Veo video"
                });
            }
            else
            {
                return new ProviderPollResult { Status = "PROCESSING" };
            }
        }

        return new ProviderPollResult { Status = "COMPLETED", Assets = assets };
    }

    private async Task<JsonDocument> SendJsonAsync(HttpMethod method, string url, object? payload, CancellationToken cancellationToken)
    {
        using var client = _httpClientFactory.CreateClient();
        using var request = new HttpRequestMessage(method, url);
        request.Headers.Add("x-goog-api-key", _apiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        if (payload != null)
        {
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull });
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Google Veo call failed. Status={StatusCode}, Url={Url}, Body={Body}", (int)response.StatusCode, url, body);
            throw new InvalidOperationException($"Google Veo lỗi {(int)response.StatusCode}: {body}");
        }

        return JsonDocument.Parse(body);
    }

    private async Task<byte[]> DownloadBytesAsync(string url, CancellationToken cancellationToken)
    {
        using var client = _httpClientFactory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("x-goog-api-key", _apiKey);
        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }

    private static Dictionary<string, object?> BuildInlineData(string path)
    {
        var bytes = File.ReadAllBytes(path);
        return new Dictionary<string, object?>
        {
            ["inlineData"] = new Dictionary<string, object?>
            {
                ["mimeType"] = GetMimeType(path),
                ["data"] = Convert.ToBase64String(bytes)
            }
        };
    }

    private static string? ExtractVideoUri(JsonElement root)
    {
        if (root.TryGetProperty("response", out var responseEl))
        {
            if (responseEl.TryGetProperty("generateVideoResponse", out var videoResponseEl)
                && videoResponseEl.TryGetProperty("generatedSamples", out var samplesEl)
                && samplesEl.ValueKind == JsonValueKind.Array
                && samplesEl.GetArrayLength() > 0)
            {
                var sample = samplesEl[0];
                if (sample.TryGetProperty("video", out var videoEl) && videoEl.TryGetProperty("uri", out var uriEl))
                {
                    return uriEl.GetString();
                }
            }

            if (responseEl.TryGetProperty("generatedVideos", out var generatedVideosEl)
                && generatedVideosEl.ValueKind == JsonValueKind.Array
                && generatedVideosEl.GetArrayLength() > 0)
            {
                var sample = generatedVideosEl[0];
                if (sample.TryGetProperty("video", out var videoEl) && videoEl.TryGetProperty("uri", out var uriEl))
                {
                    return uriEl.GetString();
                }
            }
        }

        return null;
    }

    private static List<string> SplitPrompts(string? promptText, int expectedCount)
    {
        var prompts = (promptText ?? string.Empty)
            .Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .ToList();

        if (prompts.Count == 0)
        {
            prompts.Add("Create a clean commercial video.");
        }

        if (expectedCount > 0 && prompts.Count > expectedCount)
        {
            prompts = prompts.Take(expectedCount).ToList();
        }

        return prompts;
    }

    private static string NormalizeVideoModel(string? model)
    {
        if (string.IsNullOrWhiteSpace(model)) return "veo-3.1-fast-generate-preview";
        if (string.Equals(model, "veo-3.1-fast", StringComparison.OrdinalIgnoreCase)) return "veo-3.1-fast-generate-preview";
        return model;
    }

    private static string NormalizeAspectRatio(string? aspectRatio)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "16:9", "9:16" };
        return allowed.Contains(aspectRatio ?? string.Empty) ? aspectRatio! : "16:9";
    }

   private static int NormalizeDuration(int seconds)
{
    var allowed = new[] { 4, 6, 8 };
    return allowed.Contains(seconds) ? seconds : 8;
}

    private static string GetMimeType(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".jpg" or ".jpeg" => "image/jpeg",
            _ => "application/octet-stream"
        };
    }

    private void EnsureConfigured()
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            throw new InvalidOperationException("Thiếu GOOGLE_API_KEY / Providers:Google:ApiKey để gọi Google Veo thật.");
        }
    }
}
