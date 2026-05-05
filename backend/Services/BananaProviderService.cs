using System.Text;
using System.Text.Json;
using mydb_putty_101.Contracts;

namespace mydb_putty_101.Services;

public class BananaProviderService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<BananaProviderService> _logger;
    private readonly string _baseUrl;
    private readonly string _apiKey;

    public BananaProviderService(IHttpClientFactory httpClientFactory, IConfiguration configuration, ILogger<BananaProviderService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _baseUrl = (configuration["Providers:Google:BaseUrl"]
            ?? configuration["Providers:Banana:BaseUrl"]
            ?? "https://generativelanguage.googleapis.com").TrimEnd('/');
        _apiKey = Environment.GetEnvironmentVariable("GOOGLE_API_KEY")
            ?? configuration["Providers:Google:ApiKey"]
            ?? configuration["Providers:Banana:ApiKey"]
            ?? string.Empty;
    }

    public async Task<List<ProviderAsset>> GenerateImagesAsync(JobRecord job, string? uploadedImagePath, CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        var normalizedModel = NormalizeImageModel(job.Model);

        if (normalizedModel.StartsWith("imagen-", StringComparison.OrdinalIgnoreCase))
        {
            return await GenerateWithImagenAsync(job, normalizedModel, cancellationToken);
        }

        return await GenerateWithGeminiImageAsync(job, normalizedModel, uploadedImagePath, cancellationToken);
    }

    private async Task<List<ProviderAsset>> GenerateWithImagenAsync(JobRecord job, string model, CancellationToken cancellationToken)
    {
        using var client = _httpClientFactory.CreateClient();
        var payload = new Dictionary<string, object?>
        {
            ["instances"] = new[]
            {
                new Dictionary<string, object?>
                {
                    ["prompt"] = string.IsNullOrWhiteSpace(job.Prompt) ? "Create a commercial image." : job.Prompt
                }
            },
            ["parameters"] = new Dictionary<string, object?>
            {
                ["sampleCount"] = Math.Clamp(job.ResultCount, 1, 4),
                ["aspectRatio"] = NormalizeImageAspect(job.AspectRatio),
                ["personGeneration"] = "allow_adult"
            }
        };

        var doc = await PostJsonAsync(client, $"{_baseUrl}/v1beta/models/{model}:predict", payload, cancellationToken);
        var assets = new List<ProviderAsset>();

        if (doc.RootElement.TryGetProperty("predictions", out var predictionsEl) && predictionsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var prediction in predictionsEl.EnumerateArray())
            {
                if (prediction.TryGetProperty("bytesBase64Encoded", out var base64El))
                {
                    assets.Add(new ProviderAsset
                    {
                        Type = "image",
                        Bytes = Convert.FromBase64String(base64El.GetString() ?? string.Empty),
                        MimeType = "image/png",
                        SuggestedExtension = ".png",
                        Title = "Google Imagen image",
                        SizeLabel = "HD"
                    });
                }
            }
        }

        if (assets.Count == 0)
        {
            throw new InvalidOperationException("Google Imagen không trả về ảnh.");
        }

        return assets;
    }

    private async Task<List<ProviderAsset>> GenerateWithGeminiImageAsync(JobRecord job, string model, string? uploadedImagePath, CancellationToken cancellationToken)
    {
        using var client = _httpClientFactory.CreateClient();
        var assets = new List<ProviderAsset>();
        var count = Math.Clamp(job.ResultCount, 1, 4);

        for (var i = 0; i < count; i++)
        {
            var parts = new List<object>
            {
                new Dictionary<string, object?> { ["text"] = string.IsNullOrWhiteSpace(job.Prompt) ? "Create a commercial image." : job.Prompt }
            };

            if (!string.IsNullOrWhiteSpace(uploadedImagePath) && File.Exists(uploadedImagePath))
            {
                parts.Add(new Dictionary<string, object?>
                {
                    ["inlineData"] = new Dictionary<string, object?>
                    {
                        ["mimeType"] = GetMimeType(uploadedImagePath),
                        ["data"] = Convert.ToBase64String(await File.ReadAllBytesAsync(uploadedImagePath, cancellationToken))
                    }
                });
            }

            var payload = new Dictionary<string, object?>
            {
                ["contents"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["parts"] = parts
                    }
                },
                ["generationConfig"] = new Dictionary<string, object?>
                {
                    ["responseModalities"] = new[] { "IMAGE" },
                    ["imageConfig"] = new Dictionary<string, object?>
                    {
                        ["aspectRatio"] = NormalizeImageAspect(job.AspectRatio),
                        ["imageSize"] = "2K"
                    }
                }
            };

            var doc = await PostJsonAsync(client, $"{_baseUrl}/v1beta/models/{model}:generateContent", payload, cancellationToken);
            var imageBytes = ExtractImageBytes(doc.RootElement);
            if (imageBytes == null || imageBytes.Length == 0)
            {
                throw new InvalidOperationException("Google Gemini Image không trả về ảnh.");
            }

            assets.Add(new ProviderAsset
            {
                Type = "image",
                Bytes = imageBytes,
                MimeType = "image/png",
                SuggestedExtension = ".png",
                Title = "Google Gemini image",
                SizeLabel = "2K"
            });
        }

        return assets;
    }

    private async Task<JsonDocument> PostJsonAsync(HttpClient client, string url, object payload, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Add("x-goog-api-key", _apiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Google image call failed. Status={StatusCode}, Url={Url}, Body={Body}", (int)response.StatusCode, url, body);
            throw new InvalidOperationException($"Google Image lỗi {(int)response.StatusCode}: {body}");
        }

        return JsonDocument.Parse(body);
    }

    private static byte[]? ExtractImageBytes(JsonElement root)
    {
        if (root.TryGetProperty("candidates", out var candidatesEl) && candidatesEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var candidate in candidatesEl.EnumerateArray())
            {
                if (candidate.TryGetProperty("content", out var contentEl)
                    && contentEl.TryGetProperty("parts", out var partsEl)
                    && partsEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var part in partsEl.EnumerateArray())
                    {
                        if (part.TryGetProperty("inlineData", out var inlineEl)
                            && inlineEl.TryGetProperty("data", out var dataEl))
                        {
                            var value = dataEl.GetString();
                            if (!string.IsNullOrWhiteSpace(value)) return Convert.FromBase64String(value);
                        }
                    }
                }
            }
        }

        return null;
    }

    private static string NormalizeImageModel(string? model)
    {
        if (string.IsNullOrWhiteSpace(model)) return "gemini-3.1-flash-image-preview";
        return model.Trim().ToLowerInvariant() switch
        {
            "imagen-4" => "imagen-4.0-generate-001",
            "imagen-4-fast" => "imagen-4.0-fast-generate-001",
            _ => model
        };
    }

    private static string NormalizeImageAspect(string? aspectRatio)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "1:1", "3:4", "4:3", "4:5", "9:16", "16:9" };
        if (string.Equals(aspectRatio, "4:5", StringComparison.OrdinalIgnoreCase)) return "3:4";
        return allowed.Contains(aspectRatio ?? string.Empty) ? aspectRatio! : "1:1";
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
            throw new InvalidOperationException("Thiếu GOOGLE_API_KEY / Providers:Google:ApiKey để gọi Google Image thật.");
        }
    }
}
