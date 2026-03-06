using AiSchGeneratorApi.Services;
using System.ComponentModel;
using System.Text.Json;

namespace AiSchGeneratorApi.Tools;

public class ComponentSearchTool(ComponentService componentService)
{
    [Description("按元件名称或型号在立创官方综合库中搜索可用元件，返回元件 UUID 和 LCSC 编号的 JSON。无结果时返回 COMPONENT_NOT_FOUND 错误码。")]
    public async Task<string> SearchComponentAsync(
        [Description("元件名称或型号，如 'AMS1117-3.3'、'100nF 0402 电容'、'NPN 通用三极管'")] string componentName,
        CancellationToken cancellationToken = default)
    {
        var results = await componentService.SearchAsync(componentName, cancellationToken);

        if (results.Count == 0)
            return """{"code":"COMPONENT_NOT_FOUND","message":"未找到符合条件的立创库元件"}""";

        return JsonSerializer.Serialize(results, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });
    }
}
