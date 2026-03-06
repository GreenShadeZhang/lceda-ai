using AiSchGeneratorApi.Models;

namespace AiSchGeneratorApi.Services;

/// <summary>
/// 立创官方元件库搜索服务。
/// 当前为 POC Mock 实现（Spike 待确认真实 endpoint 后替换）。
/// 真实 endpoint 参考: GET https://pro.easyeda.com/api/devices?q={query}&amp;page=1&amp;perPage=10
/// </summary>
// TODO: (Spike) 验证立创EDA Pro 真实 endpoint 后，_httpClient 将替换 mock 实现
#pragma warning disable CS9113 // Mock 阶段 _httpClient 暂未使用
public class ComponentService(HttpClient _httpClient, ILogger<ComponentService> logger)
#pragma warning restore CS9113
{
    public Task<List<ComponentResult>> SearchAsync(string query, CancellationToken ct = default)
    {
        // TODO: (Spike) 抓包立创EDA Pro 验证真实 endpoint，替换以下 Mock 实现
        if (query.Contains("AMS1117", StringComparison.OrdinalIgnoreCase))
        {
            return Task.FromResult(new List<ComponentResult>
            {
                new("C6186", "AMS1117-3.3", "60ce3fd5ef5cc800e53b2e6e", "基础库", true)
            });
        }

        logger.LogDebug("ComponentService mock: no results for query={Query}", query);
        return Task.FromResult(new List<ComponentResult>());
    }
}
