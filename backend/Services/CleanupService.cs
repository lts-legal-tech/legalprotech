namespace mydb_putty_101.Services;

public class CleanupService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;

    public CleanupService(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var scope = _serviceProvider.CreateScope();
            var store = scope.ServiceProvider.GetRequiredService<JobStore>();
            store.CleanupExpired();
            await Task.Delay(TimeSpan.FromMinutes(10), stoppingToken);
        }
    }
}
