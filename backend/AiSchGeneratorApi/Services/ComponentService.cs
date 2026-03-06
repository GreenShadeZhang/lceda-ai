using AiSchGeneratorApi.Models;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AiSchGeneratorApi.Services;

/// <summary>
/// 立创官方元件库验证服务。
/// 使用与 easyeda2kicad 相同的公开 API（无需登录）：
/// GET https://easyeda.com/api/products/{lcsc_id}/components?version=6.4.19.5
/// </summary>
public class ComponentService(HttpClient httpClient, ILogger<ComponentService> logger)
{
    private const string ProductApiTemplate = "https://easyeda.com/api/products/{0}/components?version=6.4.19.5";
    private static readonly Regex LcscIdPattern = new(@"^C\d+$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// 通过 LCSC 编号（如 C6186）直接验证元件是否存在于立创EDA库，并返回 UUID 和规范名称。
    /// 无需登录，公开 API 即可访问。
    /// </summary>
    public async Task<ComponentResult?> GetByLcscIdAsync(string lcscId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(lcscId) || !LcscIdPattern.IsMatch(lcscId))
            return null;

        var upperLcsc = lcscId.ToUpperInvariant();
        try
        {
            var url = string.Format(ProductApiTemplate, Uri.EscapeDataString(upperLcsc));
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("Accept", "application/json,text/javascript,*/*; q=0.01");
            req.Headers.Add("User-Agent", "easyeda2kicad v0.8.0");

            using var resp = await httpClient.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                logger.LogWarning("EasyEDA API returned {Code} for lcsc={LcscId}", resp.StatusCode, upperLcsc);
                return null;
            }

            var json = await resp.Content.ReadAsStringAsync(ct);
            return ParseProductResponse(json, upperLcsc);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "EasyEDA API call failed for lcsc={LcscId}", upperLcsc);
            return null;
        }
    }

    /// <summary>
    /// 兼容旧接口。若 query 形如 C\d+（LCSC 编号），走 GetByLcscIdAsync；否则返回空列表。
    /// 注意：pro.easyeda.com 关键词搜索需要登录 cookie，此处不支持。
    /// </summary>
    public async Task<List<ComponentResult>> SearchAsync(string query, CancellationToken ct = default)
    {
        query = query.Trim();
        if (LcscIdPattern.IsMatch(query))
        {
            var result = await GetByLcscIdAsync(query, ct);
            return result is not null ? [result] : [];
        }

        logger.LogDebug("立创EDA 关键词搜索需要登录，跳过: query={Query}", query);
        return [];
    }

    private ComponentResult? ParseProductResponse(string json, string lcscId)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (!root.TryGetProperty("success", out var succ) || succ.GetBoolean() != true)
                return null;
            if (!root.TryGetProperty("result", out var result))
                return null;

            var uuid  = result.TryGetProperty("uuid",  out var u) ? u.GetString() ?? "" : "";
            var title = result.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";

            // 以 API 返回的 LCSC 编号为准（result.lcsc.number 或 result.szlcsc.number）
            var confirmedLcsc = lcscId;
            foreach (var field in new[] { "lcsc", "szlcsc" })
            {
                if (result.TryGetProperty(field, out var lcscNode) &&
                    lcscNode.TryGetProperty("number", out var num))
                {
                    confirmedLcsc = num.GetString() ?? lcscId;
                    break;
                }
            }

            if (string.IsNullOrEmpty(uuid))
            {
                logger.LogDebug("EasyEDA API: lcsc={Lcsc} 无 UUID，可能不存在", lcscId);
                return null;
            }

            logger.LogDebug("EasyEDA API: 找到 {Title} lcsc={Lcsc} uuid={Uuid}", title, confirmedLcsc, uuid);
            return new ComponentResult(confirmedLcsc, title, uuid, "立创EDA", true);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "解析 EasyEDA API 响应失败 lcsc={LcscId}", lcscId);
            return null;
        }
    }
}
