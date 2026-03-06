namespace AiSchGeneratorApi.Models;

/// <summary>从立创官方库搜索返回的元件信息。</summary>
public record ComponentResult(
    string Lcsc,       // "C6186"                    — 立创商城 C 编号
    string Name,       // "AMS1117-3.3"              — 元件型号/名称
    string Uuid,       // 立创官方库 UUID             — 供插件侧 getByLcscIds() 验证
    string Library,    // "基础库" | "扩展库" | "用户库"
    bool   IsActive    // false = 停产，搜索时应排除
);
