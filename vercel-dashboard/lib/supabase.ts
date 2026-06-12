import { createClient } from '@supabase/supabase-js';

// 대시보드는 anon 키(읽기 전용)로 Supabase 집계 View 만 조회한다.
// 집계는 전부 DB(View)에서 끝나 있으므로 프런트는 단순 조회·렌더만 한다.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = supabaseConfigured
  ? createClient(url as string, anonKey as string, { auth: { persistSession: false } })
  : null;

// ── 타입 ────────────────────────────────────────────────
export type Breakdown = Record<string, number>;

export interface WeeklySummary {
  week_label: string;
  total: number;
  first_filter: number;
  second_filter: number;
  handover: number;
  filter_rate: number;
  handover_rate: number;
  avg_days: number;
  by_dept: Breakdown;
  by_type: Breakdown;
  by_status: Breakdown;
  ai_summary: string | null;
  ai_highlights: string[] | null;
  ai_suggestions: string[] | null;
  ai_source: string | null;
  updated_at: string | null;
}

export interface MonthlySummary {
  month: string;
  total: number;
  first_filter: number;
  second_filter: number;
  handover: number;
  filter_rate: number;
  avg_days: number;
}

export interface TotalSummary {
  total: number;
  first_filter: number;
  second_filter: number;
  handover: number;
  filter_rate: number;
  handover_rate: number;
  avg_days: number;
}

/** 총 누적현황(전체 기간 1행) */
export async function getTotalSummary(): Promise<TotalSummary | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('cs_v_total_summary').select('*').limit(1);
  if (error) {
    console.error('getTotalSummary:', error.message);
    return null;
  }
  return (data && data[0]) ? (data[0] as TotalSummary) : null;
}

/** 주차 통합 요약(집계 + 분해 + AI) — 최신 주차부터 */
export async function getWeeklySummaries(limit = 12): Promise<WeeklySummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cs_v_weekly_full')
    .select('*')
    .order('week_label', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('getWeeklySummaries:', error.message);
    return [];
  }
  return (data ?? []) as WeeklySummary[];
}

/** 월간 추이 — 최신 월부터 */
export async function getMonthlySummaries(limit = 6): Promise<MonthlySummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cs_v_monthly_summary')
    .select('*')
    .order('month', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('getMonthlySummaries:', error.message);
    return [];
  }
  return (data ?? []) as MonthlySummary[];
}
