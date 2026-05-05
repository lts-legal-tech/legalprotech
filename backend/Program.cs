using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.FileProviders;
using mydb_putty_101.Services;

namespace mydb_putty_101
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            builder.Services.AddControllers();
            builder.Services.Configure<FormOptions>(options =>
            {
                options.MultipartBodyLengthLimit = 50 * 1024 * 1024;
            });
            builder.Services.AddHttpClient();
            builder.Services.AddSingleton<VeoProviderService>();
            builder.Services.AddSingleton<BananaProviderService>();
            builder.Services.AddSingleton<JobStore>();
            builder.Services.AddHostedService<CleanupService>();

            var app = builder.Build();
            var storageRoot = Path.Combine(app.Environment.ContentRootPath, "Storage");
            var filesRoot = Path.Combine(storageRoot, "files");
            var downloadsRoot = Path.Combine(storageRoot, "downloads");
            Directory.CreateDirectory(filesRoot);
            Directory.CreateDirectory(downloadsRoot);

            app.UseRouting();
            app.UseStaticFiles();
            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = new PhysicalFileProvider(filesRoot),
                RequestPath = "/files"
            });
            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = new PhysicalFileProvider(downloadsRoot),
                RequestPath = "/downloads"
            });
            app.MapControllers();
            app.Run();
        }
    }
}
