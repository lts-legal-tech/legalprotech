using Microsoft.AspNetCore.Http;

namespace mydb_putty_101.Contracts;

public class CreateJobRequest
{
    public string? Tool { get; set; }
    public string? Prompt { get; set; }
    public string? Model { get; set; }
    public string? Aspect_Ratio { get; set; }
    public string? Duration { get; set; }
    public int? Count { get; set; }
    public string? Character_Id { get; set; }
    public IFormFile? Image { get; set; }
    public IFormFile? Reference_Image { get; set; }
}

public class ResultActionRequest
{
    public string? Token { get; set; }
    public string? Action { get; set; }
}

public class JobRecord
{
    public string JobId { get; set; } = string.Empty;
    public string Tool { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string Status { get; set; } = "QUEUED";
    public string AspectRatio { get; set; } = "16:9";
    public int Duration { get; set; } = 5;
    public int ResultCount { get; set; } = 0;
    public string? CharacterId { get; set; }
    public string? ReferenceImageName { get; set; }
    public string? UploadedImageName { get; set; }
    public string? ProviderJobId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAtUtc { get; set; }
    public DateTime? ExpiresAtUtc { get; set; }
    public string? Token { get; set; }
    public string? ZipPath { get; set; }
    public string? ShareUrl { get; set; }
    public List<ResultItem> Results { get; set; } = new();
}

public class ResultItem
{
    public string Id { get; set; } = string.Empty;
    public string Type { get; set; } = "video";
    public string Provider { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string Thumbnail { get; set; } = string.Empty;
    public int Duration { get; set; } = 5;
    public string AspectRatio { get; set; } = "16:9";
    public string? Title { get; set; }
    public string? SizeLabel { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ProviderPollResult
{
    public string Status { get; set; } = "PROCESSING";
    public string? ErrorMessage { get; set; }
    public List<ProviderAsset> Assets { get; set; } = new();
}

public class ProviderAsset
{
    public string Type { get; set; } = "video";
    public byte[]? Bytes { get; set; }
    public string? MimeType { get; set; }
    public string? SuggestedExtension { get; set; }
    public string? ThumbnailBytesBase64 { get; set; }
    public string? ThumbnailMimeType { get; set; }
    public string? Title { get; set; }
    public string? SizeLabel { get; set; }
}
