export type GroupingErrorKind = 'auth' | 'rate_limit' | 'network' | 'parse' | 'apply';

export class GroupingError extends Error {
  kind: GroupingErrorKind;
  constructor(kind: GroupingErrorKind, message: string) {
    super(message);
    this.name = 'GroupingError';
    this.kind = kind;
  }
}

export function httpErrorKind(status: number): 'auth' | 'rate_limit' | 'network' {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return 'network';
}

export function groupingErrorMessage(error: unknown): string {
  if (error instanceof GroupingError) {
    if (error.kind === 'auth') return '密钥或模型权限不可用，请在模型服务中检查配置并测试连接。';
    if (error.kind === 'rate_limit') return '服务请求受限或额度不足，请检查账户额度后重试。';
    if (error.kind === 'parse') return '模型未返回有效的分组方案，请重试或更换模型。';
    if (error.kind === 'apply') return '未能完成书签移动，已尝试恢复原位置。请检查书签后重试。';
  }
  return '暂时无法完成整理，请检查网络与模型服务后重试。';
}
