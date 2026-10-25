using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PaCT.Api.Identity;
using PaCT.Api.Testimonials;

namespace PaCT.Api.Controllers;

public sealed class TestimonialForm
{
    public long Version { get; set; }
    public string OperationId { get; set; } = "";
    public string? Text { get; set; }
    public bool Published { get; set; }
    public bool RemoveImage { get; set; }
    public IFormFile? Image { get; set; }
}

[ApiController, Route("api/testimonials"), Authorize(Roles = Roles.Managers)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TestimonialsController(ITestimonialStore store, TestimonialImageStore images, TimeProvider time) : ControllerBase
{
    private static object EditorView(Testimonial row) => new { row.Id, row.Text, row.Published, row.Version, row.OperationId,
        imageUrl = row.ImageId is null ? null : $"/api/testimonials/{row.Id}/images/{row.ImageId}" };
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok((await store.ReadAsync(false, ct)).Select(EditorView));

    [HttpPost("{id:guid}"), EnableRateLimiting("upload"), RequestSizeLimit(5242880), RequestFormLimits(MultipartBodyLengthLimit = 5242880)]
    public async Task<IActionResult> Save(string id, [FromForm] TestimonialForm form, CancellationToken ct)
    {
        if (Request.Form.Files.Count > 1 || Request.Form.Files.Any(file => file.Name != "image"))
            throw new IdentityProblem(400, "Cada publicação pode ter apenas uma imagem.");
        byte[]? bytes = null;
        if (form.Image is not null)
        {
            if (form.Image.Length is 0 or > 4194304) throw new IdentityProblem(400, "A imagem pode ter até 4 MB.");
            using var buffer = new MemoryStream(); await form.Image.CopyToAsync(buffer, ct); bytes = buffer.ToArray();
            PaCT.Api.Consultations.ConsultationPhotoStore.ValidateImage(bytes, form.Image.ContentType);
        }
        var input = new TestimonialChange(id, form.Version, form.OperationId, form.Text ?? "", form.Published, form.RemoveImage);
        var hash = TestimonialRules.Hash(input, bytes); var author = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var result = await store.ChangeAsync(id, async current =>
        {
            var next = TestimonialRules.Apply(current, input, bytes is not null, hash, author, time.GetUtcNow().UtcDateTime);
            if (next != current && bytes is not null) await images.SaveAsync(new(id, next.ImageId!, form.Image!.ContentType, bytes), ct);
            return next;
        }, ct);
        return Ok(new { confirmed = true, publication = EditorView(result) });
    }
    [HttpGet("{id:guid}/images/{imageId:guid}")]
    public async Task<IActionResult> Image(string id, string imageId, CancellationToken ct)
    {
        var row = await store.FindAsync(id, ct);
        if (row?.ImageId != imageId) return NotFound();
        var image = await images.ReadAsync(id, imageId, ct); return File(image.Bytes, image.ContentType);
    }
}

[ApiController, Route("api/public/testimonials"), AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PublicTestimonialsController(ITestimonialStore store, TestimonialImageStore images) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok((await store.ReadAsync(true, ct)).Where(row => row.Published).Select(row => new
    { row.Id, row.Text, imageUrl = row.ImageId is null ? null : $"/api/public/testimonials/{row.Id}/images/{row.ImageId}" }));
    [HttpGet("{id:guid}/images/{imageId:guid}")]
    public async Task<IActionResult> Image(string id, string imageId, CancellationToken ct)
    {
        var row = await store.FindAsync(id, ct);
        if (row is null || !row.Published || row.ImageId != imageId) return NotFound();
        var image = await images.ReadAsync(id, imageId, ct); return File(image.Bytes, image.ContentType);
    }
}
