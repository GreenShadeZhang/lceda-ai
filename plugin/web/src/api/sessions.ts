import { apiGet, apiPost } from './client';
import type { ApiResponse, PagedResult } from '../types/api';

export interface SessionDto {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
}

export interface SessionDetailDto extends SessionDto {
  messages: Array<{ role: string; content: string; createdAt: string }>;
}

export async function getSessions(pageSize = 20): Promise<SessionDto[]> {
  const res = await apiGet<ApiResponse<PagedResult<SessionDto>>>(
    `/api/sessions?pageSize=${pageSize}&pageIndex=1`,
  );
  return res.data?.items ?? [];
}

export async function createSession(): Promise<SessionDto> {
  const res = await apiPost<ApiResponse<SessionDto>>('/api/sessions', {});
  if (!res.data) throw new Error('Failed to create session');
  return res.data;
}

export async function getSessionDetail(id: string): Promise<SessionDetailDto | null> {
  const res = await apiGet<ApiResponse<SessionDetailDto>>(`/api/sessions/${id}`);
  return res.data ?? null;
}
