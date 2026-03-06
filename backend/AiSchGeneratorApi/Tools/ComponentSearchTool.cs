using AiSchGeneratorApi.Services;
using System.ComponentModel;
using System.Text.Json;

namespace AiSchGeneratorApi.Tools;

public class ComponentSearchTool(ComponentService componentService)
{
    [Description("通过 LCSC 编号（如 C6186）验证元件是否存在于立创EDA官方库，返回 UUID 和元件名称的 JSON。找不到时返回 COMPONENT_NOT_FOUND。")]
    public async Task<string> SearchComponentAsync(
        [Description("LCSC 元件编号，格式为 C 后跟数字，如 'C6186'（AMS1117-3.3）、'C21190'（100nF 0402）、'C17024'（10µF 0805）")] string lcscId,
        CancellationToken cancellationToken = default)
    {
        var result = await componentService.GetByLcscIdAsync(lcscId, cancellationToken);

        if (result is null)
            return $"{{\"code\":\"COMPONENT_NOT_FOUND\",\"message\":\"LCSC {lcscId} 不存在于立创EDA库\"}}";

        return JsonSerializer.Serialize(result, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });
    }
}
