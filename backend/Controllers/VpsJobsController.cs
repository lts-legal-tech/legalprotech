using Microsoft.AspNetCore.Mvc;
using mydb_putty_101.Contracts;
using mydb_putty_101.Services;

namespace mydb_putty_101.Controllers;

[ApiController]
public class VpsJobsController : ControllerBase
{
    private readonly JobStore _store;

    public VpsJobsController(JobStore store)
    {
        _store = store;
    }

    [HttpPost("jobs/create")]
    [RequestSizeLimit(50_000_000)]
    public IActionResult Create([FromForm] CreateJobRequest request)
    {
        if (!_store.IsAuthorized(Request)) return StatusCode(401, new { success = false, errorCode = "UNAUTHORIZED", message = "Invalid API key" });
        if (_store.ActiveQueueCount() >= 40) return StatusCode(429, new { success = false, errorCode = "QUEUE_LIMIT_REACHED", message = "Global queue limit of 40 jobs has been reached" });

        var job = _store.CreateJob(request);
        return Ok(new { success = true, jobId = job.JobId, status = job.Status, message = "Job has been queued" });
    }

    [HttpGet("jobs/status")]
    public IActionResult Status([FromQuery] string jobId)
    {
        if (!_store.IsAuthorized(Request)) return StatusCode(401, new { success = false, errorCode = "UNAUTHORIZED", message = "Invalid API key" });

        var job = _store.GetByJobId(jobId);
        if (job == null) return NotFound(new { success = false, errorCode = "JOB_NOT_FOUND", message = "Không tìm thấy job" });
        if (job.Status == "FAILED") return StatusCode(500, new { success = false, jobId, status = job.Status, errorCode = "PROVIDER_ERROR", message = "Provider failed to return valid output" });

        if (job.Status == "COMPLETED")
        {
            return Ok(new
            {
                success = true,
                jobId = job.JobId,
                status = job.Status,
                message = "Job completed",
                token = job.Token,
                expiresAt = job.ExpiresAtUtc?.ToString("O"),
                resultCount = job.Results.Count,
                results = job.Results,
                zipUrl = job.ZipPath
            });
        }

        return Ok(new
        {
            success = true,
            jobId = job.JobId,
            status = job.Status,
            message = job.Status == "PROCESSING" ? "Google đang xử lý job" : "Job has been queued"
        });
    }

    [HttpGet("results/{token}")]
    public IActionResult Results(string token)
    {
        if (!_store.IsAuthorized(Request)) return StatusCode(401, new { success = false, errorCode = "UNAUTHORIZED", message = "Invalid API key" });

        var job = _store.GetByToken(token);
        if (job == null) return NotFound(new { success = false, errorCode = "TOKEN_NOT_FOUND", message = "Token không tồn tại" });
        if (job.Status == "EXPIRED") return StatusCode(410, new { success = false, errorCode = "TOKEN_EXPIRED", message = "Result batch has expired" });

        return Ok(new
        {
            success = true,
            token,
            expiresAt = job.ExpiresAtUtc?.ToString("O"),
            resultCount = job.Results.Count,
            results = job.Results,
            zipUrl = job.ZipPath,
            shareUrl = job.ShareUrl
        });
    }

    [HttpPost("results/action")]
    public IActionResult Action([FromBody] ResultActionRequest request)
    {
        if (!_store.IsAuthorized(Request)) return StatusCode(401, new { success = false, errorCode = "UNAUTHORIZED", message = "Invalid API key" });
        var result = _store.ApplyAction(request);
        return Ok(result);
    }
}
