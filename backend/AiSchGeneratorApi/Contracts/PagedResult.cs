namespace AiSchGeneratorApi.Contracts;

/// <summary>分页查询结果通用包装器。</summary>
public class PagedResult<T>
{
    /// <summary>当前页的数据项列表。</summary>
    public IEnumerable<T> Items { get; init; } = [];

    /// <summary>符合条件的总记录数（不分页）。</summary>
    public int Total { get; init; }
}
