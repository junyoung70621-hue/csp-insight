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

/** 주차 통합 요약(집계 + 분해 + AI) — 최신 주차부터, offset 페이지네이션 */
export async function getWeeklySummaries(limit = 12, offset = 0): Promise<WeeklySummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cs_v_weekly_full')
    .select('*')
    .order('week_label', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.error('getWeeklySummaries:', error.message); return []; }
  return (data ?? []) as WeeklySummary[];
}

export interface Insight {
  week_label: string;
  ai_summary: string | null;
  ai_highlights: string[] | null;
  ai_suggestions: string[] | null;
  ai_source: string | null;
  updated_at: string | null;
}

/** 최신 주차의 Gemini 요약 */
export async function getLatestInsight(): Promise<Insight | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('cs_v_weekly_full')
    .select('week_label, ai_summary, ai_highlights, ai_suggestions, ai_source, updated_at')
    .not('ai_summary', 'is', null)
    .order('week_label', { ascending: false })
    .limit(1);
  if (error) { console.error('getLatestInsight:', error.message); return null; }
  return (data && data[0]) ? (data[0] as Insight) : null;
}

/** 월간 추이 — 최신 월부터 */
export async function getMonthlySummaries(limit = 12, offset = 0): Promise<MonthlySummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cs_v_monthly_summary')
    .select('*')
    .order('month', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.error('getMonthlySummaries:', error.message); return []; }
  return (data ?? []) as MonthlySummary[];
}

export interface DailySummary {
  day: string;
  total: number;
  first_filter: number;
  second_filter: number;
  handover: number;
  filter_rate: number;
  avg_days: number;
}

/** 일자별 접수현황 — 최신일부터 limit개 (차트는 오름차순으로 표시) */
export async function getDailySummaries(limit = 60, offset = 0): Promise<DailySummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cs_v_daily_summary')
    .select('*')
    .order('day', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.error('getDailySummaries:', error.message); return []; }
  return (data ?? []) as DailySummary[];
}

/** 특정 월(YYYY-MM)의 일자별 접수현황 (오름차순) */
export async function getDailyByMonth(month: string): Promise<DailySummary[]> {
  if (!supabase) return [];
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return [];
  const start = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const { data, error } = await supabase
    .from('cs_v_daily_summary').select('*')
    .gte('day', start).lt('day', next).order('day', { ascending: true });
  if (error) { console.error('getDailyByMonth:', error.message); return []; }
  return (data ?? []) as DailySummary[];
}

export interface Recontact {
  l1_total: number; l1_recontact: number; l1_rate: number;
  l2_total: number; l2_recontact: number; l2_rate: number;
}

export async function getRecontact(): Promise<Recontact | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('cs_v_recontact').select('*').limit(1);
  if (error) { console.error('getRecontact:', error.message); return null; }
  return (data && data[0]) ? (data[0] as Recontact) : null;
}

export interface KeyCount { key: string; count: number; }

/** 접수오류유형 TOP N (2차) */
export async function getTopErr(limit = 5): Promise<KeyCount[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cs_v_top_err').select('*').order('count', { ascending: false }).limit(limit);
  if (error) { console.error('getTopErr:', error.message); return []; }
  return (data ?? []) as KeyCount[];
}

export interface DeviceModel { model: string; count: number; }

/** 기종별 누적(B700/B710/B800 등) */
export async function getDeviceModels(): Promise<DeviceModel[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cs_v_device_model').select('*').order('count', { ascending: false });
  if (error) { console.error('getDeviceModels:', error.message); return []; }
  return (data ?? []) as DeviceModel[];
}

// ── 로우데이터(마스킹됨) ──────────────────────────────────────
export type Row = Record<string, any>;

/** 1차필터(전화상담) 행 — 최신순, 페이지네이션 */
export async function getL1Rows(limit = 50, offset = 0): Promise<Row[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cs_v_l1_rows').select('*').order('received_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) { console.error('getL1Rows:', error.message); return []; }
  return (data ?? []) as Row[];
}

/** 2차필터(AS) 행 — cat(2차미출동/현장인계) 필터, 최신순, 페이지네이션 */
export async function getL2Rows(cat: string | null, limit = 50, offset = 0): Promise<Row[]> {
  if (!supabase) return [];
  let q = supabase.from('cs_v_l2_rows').select('*');
  if (cat) q = q.eq('cat', cat);
  const { data, error } = await q.order('received_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) { console.error('getL2Rows:', error.message); return []; }
  return (data ?? []) as Row[];
}
