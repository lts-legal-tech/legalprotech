using System.IO.Compression;
using System.Text.Json;
using mydb_putty_101.Contracts;

namespace mydb_putty_101.Services;

public class JobStore
{
    private readonly object _sync = new();
    private readonly string _root;
    private readonly string _dataDir;
    private readonly string _filesDir;
    private readonly string _downloadsDir;
    private readonly string _apiKey;
    private readonly string _publicBaseUrl;
    private readonly bool _useRealProviders;
    private readonly VeoProviderService _veoProviderService;
    private readonly BananaProviderService _bananaProviderService;
    private readonly ILogger<JobStore> _logger;

    public JobStore(
        IConfiguration configuration,
        IWebHostEnvironment env,
        VeoProviderService veoProviderService,
        BananaProviderService bananaProviderService,
        ILogger<JobStore> logger)
    {
        _root = Path.Combine(env.ContentRootPath, "Storage");
        _dataDir = Path.Combine(_root, "data");
        _filesDir = Path.Combine(_root, "files");
        _downloadsDir = Path.Combine(_root, "downloads");
        Directory.CreateDirectory(_dataDir);
        Directory.CreateDirectory(_filesDir);
        Directory.CreateDirectory(_downloadsDir);
        _apiKey = configuration["VpsApi:ApiKey"] ?? "your_internal_api_key";
        _publicBaseUrl = (configuration["VpsApi:PublicBaseUrl"] ?? string.Empty).TrimEnd('/');
        _useRealProviders = bool.TryParse(configuration["Providers:UseRealProviders"], out var value) && value;
        _veoProviderService = veoProviderService;
        _bananaProviderService = bananaProviderService;
        _logger = logger;
    }

    public bool IsAuthorized(HttpRequest request)
    {
        if (string.IsNullOrWhiteSpace(_apiKey)) return true;
        return string.Equals(request.Headers["x-api-key"].FirstOrDefault(), _apiKey, StringComparison.Ordinal);
    }

    public int ActiveQueueCount()
    {
        lock (_sync)
        {
            return LoadAll().Count(x => x.Status is "QUEUED" or "PROCESSING");
        }
    }

    public JobRecord CreateJob(CreateJobRequest request)
    {
        lock (_sync)
        {
            var isVideo = (request.Tool ?? string.Empty).Contains("video", StringComparison.OrdinalIgnoreCase);
            var count = isVideo ? Math.Clamp(request.Count ?? 1, 1, 10) : Math.Clamp(request.Count ?? 1, 1, 4);
            var model = request.Model ?? (isVideo ? "veo-3.1-fast-generate-preview" : "gemini-3.1-flash-image-preview");
            var provider = model.Contains("veo", StringComparison.OrdinalIgnoreCase)
                ? "google-veo"
                : (model.Contains("gemini", StringComparison.OrdinalIgnoreCase) || model.Contains("imagen", StringComparison.OrdinalIgnoreCase)
                    ? "google-image"
                    : "banana");

            var job = new JobRecord
            {
                JobId = $"job_{Guid.NewGuid():N}"[..12],
                Tool = request.Tool ?? "image-to-video",
                Prompt = request.Prompt ?? string.Empty,
                Provider = provider,
                Model = model,
                Status = "QUEUED",
                AspectRatio = request.Aspect_Ratio ?? (isVideo ? "16:9" : "1:1"),
                Duration = int.TryParse(request.Duration, out var d) ? d : 5,
                ResultCount = count,
                CharacterId = request.Character_Id,
                CreatedAtUtc = DateTime.UtcNow,
                UpdatedAtUtc = DateTime.UtcNow,
            };

            if (request.Image != null) job.UploadedImageName = SaveUpload(job.JobId, "input", request.Image);
            if (request.Reference_Image != null) job.ReferenceImageName = SaveUpload(job.JobId, "reference", request.Reference_Image);

            Save(job);
            return job;
        }
    }

    public JobRecord? GetByJobId(string jobId)
    {
        lock (_sync)
        {
            var job = Load(jobId);
            if (job == null) return null;
            AdvanceJob(job);
            Save(job);
            return job;
        }
    }

    public JobRecord? GetByToken(string token)
    {
        lock (_sync)
        {
            var job = LoadAll().FirstOrDefault(x => x.Token == token);
            if (job == null) return null;
            if (job.ExpiresAtUtc.HasValue && job.ExpiresAtUtc.Value < DateTime.UtcNow) job.Status = "EXPIRED";
            Save(job);
            return job;
        }
    }

    public object ApplyAction(ResultActionRequest request)
    {
        lock (_sync)
        {
            var job = LoadAll().FirstOrDefault(x => x.Token == request.Token);
            if (job == null) return new { success = false, errorCode = "TOKEN_NOT_FOUND", message = "Token không tồn tại" };

            if (job.ExpiresAtUtc.HasValue && job.ExpiresAtUtc.Value < DateTime.UtcNow)
            {
                job.Status = "EXPIRED";
                Save(job);
                return new { success = false, errorCode = "TOKEN_EXPIRED", message = "Result batch has expired" };
            }

            switch ((request.Action ?? string.Empty).Trim())
            {
                case "save_all":
                    EnsureZip(job);
                    Save(job);
                    return new { success = true, message = "Zip package ready", zipUrl = ToExternalUrl(job.ZipPath!) };
                case "delete_all":
                    DeleteFiles(job);
                    job.Results = new List<ResultItem>();
                    job.ZipPath = null;
                    Save(job);
                    return new { success = true, message = "All results deleted" };
                case "keep_3_days":
                    job.ExpiresAtUtc = (job.ExpiresAtUtc ?? DateTime.UtcNow).AddDays(3);
                    Save(job);
                    return new { success = true, message = "Retention extended by 3 days", expiresAt = job.ExpiresAtUtc?.ToString("O") };
                case "share":
                    job.ShareUrl = BuildShareUrl(job.Token!);
                    Save(job);
                    return new { success = true, message = "Share link created", shareUrl = job.ShareUrl };
                default:
                    return new { success = false, errorCode = "INVALID_ACTION", message = "Action không hợp lệ" };
            }
        }
    }

    public void CleanupExpired()
    {
        lock (_sync)
        {
            foreach (var job in LoadAll().Where(x => x.ExpiresAtUtc.HasValue && x.ExpiresAtUtc.Value < DateTime.UtcNow).ToList())
            {
                DeleteFiles(job);
                job.Status = "EXPIRED";
                Save(job);
            }
        }
    }

    private void AdvanceJob(JobRecord job)
    {
        if (job.Status is "COMPLETED" or "FAILED" or "EXPIRED") return;

        try
        {
            if (_useRealProviders)
            {
                AdvanceRealProviderJob(job);
            }
            else
            {
                AdvanceDemoJob(job);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Provider execution failed for {JobId}", job.JobId);
            job.Status = "FAILED";
        }

        job.UpdatedAtUtc = DateTime.UtcNow;
    }

    private void AdvanceRealProviderJob(JobRecord job)
    {
        var uploadedImagePath = GetStoredPath(job.UploadedImageName);
        var referenceImagePath = GetStoredPath(job.ReferenceImageName);
        var isVideo = job.Tool.Contains("video", StringComparison.OrdinalIgnoreCase);

        if (isVideo)
        {
            if (string.IsNullOrWhiteSpace(job.ProviderJobId))
            {
                var operations = _veoProviderService
                    .CreateOperationsAsync(job, uploadedImagePath, referenceImagePath)
                    .GetAwaiter()
                    .GetResult();

                job.ProviderJobId = JsonSerializer.Serialize(operations);
                job.Status = "PROCESSING";
                return;
            }

            var operationNames = ParseOperationNames(job.ProviderJobId);
            var poll = _veoProviderService
                .PollOperationsAsync(operationNames)
                .GetAwaiter()
                .GetResult();

            if (poll.Status == "COMPLETED")
            {
                CompleteJob(job, poll.Assets);
                return;
            }

            if (poll.Status == "FAILED")
            {
                job.Status = "FAILED";
                return;
            }

            job.Status = "PROCESSING";
            return;
        }

        if (job.Results.Count == 0)
        {
            var assets = _bananaProviderService
                .GenerateImagesAsync(job, uploadedImagePath)
                .GetAwaiter()
                .GetResult();
            CompleteJob(job, assets);
            return;
        }

        job.Status = "COMPLETED";
    }

    private void AdvanceDemoJob(JobRecord job)
    {
        var elapsed = DateTime.UtcNow - job.CreatedAtUtc;
        if (elapsed < TimeSpan.FromSeconds(2)) job.Status = "QUEUED";
        else if (elapsed < TimeSpan.FromSeconds(5)) job.Status = "PROCESSING";
        else CompleteJob(job, CreateDemoAssets(job));
    }

    private void CompleteJob(JobRecord job, List<ProviderAsset> assets)
    {
        if (job.Status == "COMPLETED") return;
        job.Status = "COMPLETED";
        job.CompletedAtUtc = DateTime.UtcNow;
        job.ExpiresAtUtc = job.CompletedAtUtc.Value.AddDays(3);
        job.Token ??= $"tk_{Guid.NewGuid():N}"[..11];
        job.Results = SaveProviderAssets(job, assets);
        EnsureZip(job);
        job.ShareUrl = BuildShareUrl(job.Token);
    }

    private List<ResultItem> SaveProviderAssets(JobRecord job, List<ProviderAsset> assets)
    {
        var items = new List<ResultItem>();
        var index = 1;

        foreach (var asset in assets)
        {
            var ext = NormalizeExtension(asset.Type, asset.SuggestedExtension, asset.MimeType);
            var resultId = $"res_{Guid.NewGuid():N}"[..10];
            var resultFileName = $"{job.JobId}_{index}{ext}";
            var resultPath = Path.Combine(_filesDir, resultFileName);
            File.WriteAllBytes(resultPath, asset.Bytes ?? Array.Empty<byte>());

            string thumbVirtualPath = string.Empty;
            if (!string.IsNullOrWhiteSpace(asset.ThumbnailBytesBase64))
            {
                var thumbExt = NormalizeExtension("image", null, asset.ThumbnailMimeType);
                var thumbFileName = $"{job.JobId}_{index}_thumb{thumbExt}";
                var thumbPath = Path.Combine(_filesDir, thumbFileName);
                File.WriteAllBytes(thumbPath, Convert.FromBase64String(asset.ThumbnailBytesBase64));
                thumbVirtualPath = $"/files/{thumbFileName}";
            }
            else if (job.Tool == "image-to-video" && !string.IsNullOrWhiteSpace(job.UploadedImageName))
            {
                thumbVirtualPath = $"/files/{job.UploadedImageName}";
            }

            items.Add(new ResultItem
            {
                Id = resultId,
                Type = asset.Type,
                Provider = job.Provider,
                Model = job.Model,
                Url = $"/files/{resultFileName}",
                Thumbnail = thumbVirtualPath,
                Duration = job.Duration,
                AspectRatio = job.AspectRatio,
                Title = asset.Title ?? $"{(asset.Type == "video" ? "Video" : "Image")} {index}",
                SizeLabel = asset.SizeLabel,
                CreatedAt = DateTime.UtcNow,
            });

            index++;
        }

        return items;
    }

    private List<ProviderAsset> CreateDemoAssets(JobRecord job)
    {
        var assets = new List<ProviderAsset>();
        for (var i = 1; i <= job.ResultCount; i++)
        {
            if (job.Tool.Contains("video", StringComparison.OrdinalIgnoreCase))
            {
                assets.Add(new ProviderAsset
                {
                    Type = "video",
                    Bytes = System.Text.Encoding.UTF8.GetBytes($"Demo output for {job.JobId} item {i}"),
                    MimeType = "video/mp4",
                    SuggestedExtension = ".mp4",
                    Title = $"Demo video {i}"
                });
            }
            else
            {
                assets.Add(new ProviderAsset
                {
                    Type = "image",
                    Bytes = System.Text.Encoding.UTF8.GetBytes($"Demo output for {job.JobId} item {i}"),
                    MimeType = "image/png",
                    SuggestedExtension = ".png",
                    Title = $"Demo image {i}",
                    SizeLabel = "HD"
                });
            }
        }
        return assets;
    }

    private void EnsureZip(JobRecord job)
    {
        var zipName = $"{job.JobId}.zip";
        var zipFsPath = Path.Combine(_downloadsDir, zipName);
        if (File.Exists(zipFsPath)) File.Delete(zipFsPath);

        using var archive = ZipFile.Open(zipFsPath, ZipArchiveMode.Create);
        var manifestJson = JsonSerializer.Serialize(job, new JsonSerializerOptions { WriteIndented = true });
        var entry = archive.CreateEntry("manifest.json");
        using (var writer = new StreamWriter(entry.Open())) writer.Write(manifestJson);

        foreach (var item in job.Results)
        {
            var fullPath = Path.Combine(_filesDir, Path.GetFileName(item.Url));
            if (File.Exists(fullPath)) archive.CreateEntryFromFile(fullPath, Path.GetFileName(fullPath));

            if (!string.IsNullOrWhiteSpace(item.Thumbnail))
            {
                var thumbFullPath = Path.Combine(_filesDir, Path.GetFileName(item.Thumbnail));
                if (File.Exists(thumbFullPath)) archive.CreateEntryFromFile(thumbFullPath, Path.GetFileName(thumbFullPath));
            }
        }

        job.ZipPath = $"/downloads/{zipName}";
    }

    private void DeleteFiles(JobRecord job)
    {
        foreach (var item in job.Results)
        {
            var path = Path.Combine(_filesDir, Path.GetFileName(item.Url));
            if (File.Exists(path)) File.Delete(path);

            if (!string.IsNullOrWhiteSpace(item.Thumbnail))
            {
                var thumb = Path.Combine(_filesDir, Path.GetFileName(item.Thumbnail));
                if (File.Exists(thumb)) File.Delete(thumb);
            }
        }

        if (!string.IsNullOrWhiteSpace(job.ZipPath))
        {
            var zipPath = Path.Combine(_downloadsDir, Path.GetFileName(job.ZipPath));
            if (File.Exists(zipPath)) File.Delete(zipPath);
        }
    }

    private string SaveUpload(string jobId, string prefix, IFormFile file)
    {
        var ext = Path.GetExtension(file.FileName);
        var name = $"{jobId}_{prefix}{ext}";
        var path = Path.Combine(_filesDir, name);
        using var stream = File.Create(path);
        file.CopyTo(stream);
        return name;
    }

    private List<string> ParseOperationNames(string? providerJobId)
    {
        if (string.IsNullOrWhiteSpace(providerJobId)) return new List<string>();
        try
        {
            return JsonSerializer.Deserialize<List<string>>(providerJobId) ?? new List<string>();
        }
        catch
        {
            return new List<string> { providerJobId };
        }
    }

    private string? GetStoredPath(string? fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName)) return null;
        var path = Path.Combine(_filesDir, fileName);
        return File.Exists(path) ? path : null;
    }

    private static string NormalizeExtension(string type, string? ext, string? mimeType)
    {
        if (!string.IsNullOrWhiteSpace(ext))
        {
            return ext.StartsWith('.') ? ext : $".{ext}";
        }

        if (!string.IsNullOrWhiteSpace(mimeType))
        {
            if (mimeType.Contains("png", StringComparison.OrdinalIgnoreCase)) return ".png";
            if (mimeType.Contains("jpeg", StringComparison.OrdinalIgnoreCase) || mimeType.Contains("jpg", StringComparison.OrdinalIgnoreCase)) return ".jpg";
            if (mimeType.Contains("mp4", StringComparison.OrdinalIgnoreCase)) return ".mp4";
            if (mimeType.Contains("webp", StringComparison.OrdinalIgnoreCase)) return ".webp";
        }

        return string.Equals(type, "video", StringComparison.OrdinalIgnoreCase) ? ".mp4" : ".png";
    }

    private string BuildShareUrl(string token) => string.IsNullOrWhiteSpace(_publicBaseUrl) ? $"/shared/{token}" : $"{_publicBaseUrl}/shared/{token}";
    private string ToExternalUrl(string path) => path.StartsWith("/") ? path : $"/{path}";
    private string JsonPath(string jobId) => Path.Combine(_dataDir, $"{jobId}.json");
    private void Save(JobRecord job) => File.WriteAllText(JsonPath(job.JobId), JsonSerializer.Serialize(job, new JsonSerializerOptions { WriteIndented = true }));
    private JobRecord? Load(string jobId) => File.Exists(JsonPath(jobId)) ? JsonSerializer.Deserialize<JobRecord>(File.ReadAllText(JsonPath(jobId))) : null;
    private List<JobRecord> LoadAll() => Directory.GetFiles(_dataDir, "*.json").Select(file => JsonSerializer.Deserialize<JobRecord>(File.ReadAllText(file))!).Where(x => x != null).ToList();
}
