-- =====================================================================
-- 티머니 고객센터 전화접수 자동화 — Supabase 스키마 (v3)
--   원본 탭 2개:  1차필터(전화상담 전체) → cs_l1,  2차필터(AS/현장) → cs_l2
--   집계 정의(확정):
--     전체접수 = cs_l1 행수 + cs_l2 행수
--     필터     = cs_l1 행수 + (cs_l2 행수 − 현장인계)     ← 2차필터 '현장인계'만 제외
--     필터링율 = 필터 / 전체접수
--     현장인계 = cs_l2 의 second_filter 값이 '현장인계' 인 행
--   * 모든 객체 cs_ 접두사(다른 앱과 DB 공유 대비)
--   * GAS 는 마스킹/정규화만 → upsert(service_role). 집계는 전부 View.
--   * 중복은 PK(접수번호/합성키)로 DB 가 차단. anon 은 cs_v_* 만 SELECT.
-- SQL Editor 에 통째로 붙여넣어 실행. (재실행 안전)
-- =====================================================================

-- ── 0. 구버전(v2) 객체 정리 ─────────────────────────────────────
drop view if exists
  public.cs_v_weekly_full, public.cs_v_weekly_summary, public.cs_v_daily_summary,
  public.cs_v_monthly_summary, public.cs_v_weekly_by_dept, public.cs_v_weekly_by_type,
  public.cs_v_weekly_by_status, public.cs_v_receptions_classified cascade;
drop table if exists public.cs_receptions, public.cs_all_receptions cascade;

-- ── 1. 주차(목~차주 수) 계산 함수 ───────────────────────────────
create or replace function public.cs_week_start(d date)
returns date language sql immutable as $$
  select d - (((extract(dow from d)::int - 4) + 7) % 7);
$$;

create or replace function public.cs_week_label(ts timestamptz)
returns text language sql stable as $$
  select to_char(public.cs_week_start((ts at time zone 'Asia/Seoul')::date), 'YYYY-MM-DD')
      || '~' ||
      to_char(public.cs_week_start((ts at time zone 'Asia/Seoul')::date) + 6, 'YYYY-MM-DD');
$$;

-- ── 2. raw 테이블 ───────────────────────────────────────────────
-- 1차필터 = 전화상담 전체 (분석에 필요한 컬럼만; PII/자유텍스트 미저장)
create table if not exists public.cs_l1 (
  row_key      text primary key,               -- 합성키(전화상담은 고유ID 없음)
  received_at  timestamptz,                     -- 접수일시
  filter_flag  text,                            -- 필터여부
  dept         text,                            -- 배정부서
  channel      text,                            -- 접수채널
  consult_type text,                            -- 상담유형(대)
  status       text,                            -- 처리상태
  car_no       text,                            -- 마스킹 '***'
  region       text,                            -- 지역명
  inserted_at  timestamptz not null default now()
);
create index if not exists idx_cs_l1_received on public.cs_l1 (received_at);

-- 2차필터 = AS/현장 처리 (고유 ID = 접수번호). second_filter='현장인계' 가 현장인계.
create table if not exists public.cs_l2 (
  row_key       text primary key,              -- 접수번호 or 합성키
  reception_id  text,                           -- 접수번호
  second_filter text,                           -- '2차필터' 컬럼값('현장인계' 등)
  received_at   timestamptz,                    -- 장애접수일시
  operator      text,                           -- 교통사업자명
  office        text,                           -- 영업소명
  route         text,                           -- 노선명
  dept          text,                           -- 배정부서
  device        text,                           -- 단말기구분
  req_type      text,                           -- 접수구분
  err_type      text,                           -- 접수오류유형
  field_type    text,                           -- 현장처리유형
  car_no        text,                           -- 마스킹 '***'
  car_id        text,                           -- 마스킹 '***'
  start_at      timestamptz,                    -- 처리시작일시
  done_at       timestamptz,                    -- 처리완료일시
  done          text,                           -- 완료
  inserted_at   timestamptz not null default now()
);
create index if not exists idx_cs_l2_received on public.cs_l2 (received_at);
create index if not exists idx_cs_l2_second   on public.cs_l2 (second_filter);

-- 재접수율용 추가 컬럼(원문 차량번호 대신 단방향 해시; 1차에는 오류유형도 추가)
alter table public.cs_l1 add column if not exists car_hash text;
alter table public.cs_l1 add column if not exists err_type text;
alter table public.cs_l2 add column if not exists car_hash text;
create index if not exists idx_cs_l2_carhash on public.cs_l2 (car_hash);
create index if not exists idx_cs_l1_carhash on public.cs_l1 (car_hash);

-- AI 인사이트 (GAS 가 주차 집계 결과로 생성·저장)
create table if not exists public.cs_weekly_insight (
  week_label     text primary key,
  ai_summary     text,
  ai_highlights  jsonb not null default '[]'::jsonb,
  ai_suggestions jsonb not null default '[]'::jsonb,
  ai_source      text,
  updated_at     timestamptz not null default now()
);

-- 현장인계 판정식: second_filter 값이 '현장인계'
--   (값 표기가 바뀌면 아래 뷰들의 lower(trim(second_filter))='현장인계' 부분만 수정)

-- ── 3. 기간별 요약 View (일/주/월) — L1+L2 결합 ──────────────────
-- [집계 공식 v4]
--   1차 = cs_l1 행수(전화상담 전체, 필터됨)
--   2차 = cs_l2 중 second_filter='2차 미출동' (필터됨)
--   현장인계 = cs_l2 중 second_filter='현장인계' (필터 안 됨)
--   총합계 = 1차 + 2차 + 현장인계   (그 외 second_filter 값은 제외)
--   필터율 = (1차 + 2차) / 총합계
--   ※ '현장인계'/'2차 미출동' 표기가 바뀌면 아래 regexp_replace 비교문자열만 수정
create or replace view public.cs_v_weekly_summary as
with l1 as (
  select public.cs_week_label(received_at) k, count(*) c
  from public.cs_l1 where received_at is not null group by 1
),
l2 as (
  select public.cs_week_label(received_at) k,
    count(*) filter (where regexp_replace(trim(second_filter),'\s+',' ','g')='2차 미출동') s,
    count(*) filter (where regexp_replace(trim(second_filter),'\s+',' ','g')='현장인계') h,
    round(coalesce(avg(case when done_at is not null and done_at>=received_at
          and regexp_replace(trim(second_filter),'\s+',' ','g') in ('2차 미출동','현장인계')
          then extract(epoch from (done_at-received_at))/86400.0 end),0)::numeric,1) avgd
  from public.cs_l2 where received_at is not null group by 1
),
ks as (select k from l1 union select k from l2)
select x.k as week_label,
  coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0)       as total,
  coalesce(l1.c,0)                                         as first_filter,
  coalesce(l2.s,0)                                         as second_filter,
  coalesce(l2.h,0)                                         as handover,
  case when (coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0))=0 then 0
       else round((coalesce(l1.c,0)+coalesce(l2.s,0))*100.0
                  /(coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0)),1) end as filter_rate,
  case when (coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0))=0 then 0
       else round(coalesce(l2.h,0)*100.0/(coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0)),1) end as handover_rate,
  coalesce(l2.avgd,0)                                      as avg_days
from ks x left join l1 on l1.k=x.k left join l2 on l2.k=x.k;

create or replace view public.cs_v_daily_summary as
with l1 as (
  select (received_at at time zone 'Asia/Seoul')::date k, count(*) c
  from public.cs_l1 where received_at is not null group by 1
),
l2 as (
  select (received_at at time zone 'Asia/Seoul')::date k,
    count(*) filter (where regexp_replace(trim(second_filter),'\s+',' ','g')='2차 미출동') s,
    count(*) filter (where regexp_replace(trim(second_filter),'\s+',' ','g')='현장인계') h,
    round(coalesce(avg(case when done_at is not null and done_at>=received_at
          and regexp_replace(trim(second_filter),'\s+',' ','g') in ('2차 미출동','현장인계')
          then extract(epoch from (done_at-received_at))/86400.0 end),0)::numeric,1) avgd
  from public.cs_l2 where received_at is not null group by 1
),
ks as (select k from l1 union select k from l2)
select x.k as day,
  coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0) as total,
  coalesce(l1.c,0) as first_filter, coalesce(l2.s,0) as second_filter, coalesce(l2.h,0) as handover,
  case when (coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0))=0 then 0
       else round((coalesce(l1.c,0)+coalesce(l2.s,0))*100.0/(coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0)),1) end as filter_rate,
  coalesce(l2.avgd,0) as avg_days
from ks x left join l1 on l1.k=x.k left join l2 on l2.k=x.k;

create or replace view public.cs_v_monthly_summary as
with l1 as (
  select to_char((received_at at time zone 'Asia/Seoul'),'YYYY-MM') k, count(*) c
  from public.cs_l1 where received_at is not null group by 1
),
l2 as (
  select to_char((received_at at time zone 'Asia/Seoul'),'YYYY-MM') k,
    count(*) filter (where regexp_replace(trim(second_filter),'\s+',' ','g')='2차 미출동') s,
    count(*) filter (where regexp_replace(trim(second_filter),'\s+',' ','g')='현장인계') h,
    round(coalesce(avg(case when done_at is not null and done_at>=received_at
          and regexp_replace(trim(second_filter),'\s+',' ','g') in ('2차 미출동','현장인계')
          then extract(epoch from (done_at-received_at))/86400.0 end),0)::numeric,1) avgd
  from public.cs_l2 where received_at is not null group by 1
),
ks as (select k from l1 union select k from l2)
select x.k as month,
  coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0) as total,
  coalesce(l1.c,0) as first_filter, coalesce(l2.s,0) as second_filter, coalesce(l2.h,0) as handover,
  case when (coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0))=0 then 0
       else round((coalesce(l1.c,0)+coalesce(l2.s,0))*100.0/(coalesce(l1.c,0)+coalesce(l2.s,0)+coalesce(l2.h,0)),1) end as filter_rate,
  coalesce(l2.avgd,0) as avg_days
from ks x left join l1 on l1.k=x.k left join l2 on l2.k=x.k;

-- 총 누적현황 (전체 기간 1행)
create or replace view public.cs_v_total_summary as
with l1 as (select count(*) c from public.cs_l1),
l2 as (
  select count(*) filter (where regexp_replace(trim(second_filter),'\s+',' ','g')='2차 미출동') s,
         count(*) filter (where regexp_replace(trim(second_filter),'\s+',' ','g')='현장인계') h,
         round(coalesce(avg(case when done_at is not null and done_at>=received_at
               and regexp_replace(trim(second_filter),'\s+',' ','g') in ('2차 미출동','현장인계')
               then extract(epoch from (done_at-received_at))/86400.0 end),0)::numeric,1) avgd
  from public.cs_l2
)
select (l1.c+l2.s+l2.h) as total, l1.c as first_filter, l2.s as second_filter, l2.h as handover,
  case when (l1.c+l2.s+l2.h)=0 then 0 else round((l1.c+l2.s)*100.0/(l1.c+l2.s+l2.h),1) end as filter_rate,
  case when (l1.c+l2.s+l2.h)=0 then 0 else round(l2.h*100.0/(l1.c+l2.s+l2.h),1) end as handover_rate,
  l2.avgd as avg_days
from l1 cross join l2;

-- ── 4. 주간 항목별 분해 View (1차필터=전화상담 기준) ─────────────
create or replace view public.cs_v_weekly_by_dept as
select public.cs_week_label(received_at) as week_label,
  coalesce(nullif(trim(dept),''),'(미입력)') as key, count(*) as count
from public.cs_l1 where received_at is not null group by 1,2;

create or replace view public.cs_v_weekly_by_type as
select public.cs_week_label(received_at) as week_label,
  coalesce(nullif(trim(consult_type),''),'(미입력)') as key, count(*) as count
from public.cs_l1 where received_at is not null group by 1,2;

create or replace view public.cs_v_weekly_by_status as
select public.cs_week_label(received_at) as week_label,
  coalesce(nullif(trim(status),''),'(미입력)') as key, count(*) as count
from public.cs_l1 where received_at is not null group by 1,2;

-- ── 5. 대시보드/메일 통합 View ──────────────────────────────────
create or replace view public.cs_v_weekly_full as
select s.*,
  coalesce((select jsonb_object_agg(key,count) from public.cs_v_weekly_by_dept   d where d.week_label=s.week_label), '{}'::jsonb) as by_dept,
  coalesce((select jsonb_object_agg(key,count) from public.cs_v_weekly_by_type   t where t.week_label=s.week_label), '{}'::jsonb) as by_type,
  coalesce((select jsonb_object_agg(key,count) from public.cs_v_weekly_by_status u where u.week_label=s.week_label), '{}'::jsonb) as by_status,
  i.ai_summary, i.ai_highlights, i.ai_suggestions, i.ai_source, i.updated_at
from public.cs_v_weekly_summary s
left join public.cs_weekly_insight i on i.week_label = s.week_label;

-- ── 5-2. 재접수율 / 접수유형 TOP / 기종별 누적 ──────────────────
-- 재접수: 동일 차량(car_hash) + 동일 장애유형(err_type) 이 직전 3일 이내 재접수.
--   분모 = 차량 식별 가능한(car_hash 있는) 접수 건수.
create or replace view public.cs_v_recontact as
with l2 as (
  select c.row_key,
    exists(select 1 from public.cs_l2 p
           where p.car_hash = c.car_hash and p.err_type = c.err_type
             and p.received_at < c.received_at
             and p.received_at >= c.received_at - interval '3 days') as is_re
  from public.cs_l2 c
  where c.received_at is not null and coalesce(c.car_hash,'') <> '' and coalesce(c.err_type,'') <> ''
),
l1 as (  -- 1차는 차량번호+날짜(3일이내)만 기준 (오류유형 무시)
  select c.row_key,
    exists(select 1 from public.cs_l1 p
           where p.car_hash = c.car_hash
             and p.received_at < c.received_at
             and p.received_at >= c.received_at - interval '3 days') as is_re
  from public.cs_l1 c
  where c.received_at is not null and coalesce(c.car_hash,'') <> ''
)
select
  (select count(*) from l1)                          as l1_total,
  (select count(*) filter (where is_re) from l1)     as l1_recontact,
  case when (select count(*) from l1)=0 then 0 else round((select count(*) filter (where is_re) from l1)*100.0/(select count(*) from l1),1) end as l1_rate,
  (select count(*) from l2)                          as l2_total,
  (select count(*) filter (where is_re) from l2)     as l2_recontact,
  case when (select count(*) from l2)=0 then 0 else round((select count(*) filter (where is_re) from l2)*100.0/(select count(*) from l2),1) end as l2_rate;

-- 접수유형(접수오류유형, 2차) 빈도 — 대시보드에서 TOP5 사용
create or replace view public.cs_v_top_err as
select coalesce(nullif(trim(err_type),''),'(미입력)') as key, count(*) as count
from public.cs_l2 group by 1 order by count desc;

-- 기종별 누적: 단말기구분에서 Bxxx (B700/B710/B800 등) 추출
create or replace view public.cs_v_device_model as
select model, count(*) as count from (
  select (regexp_match(coalesce(device,''), 'B[0-9]{3}'))[1] as model from public.cs_l2
) s where model is not null group by model order by count desc;

-- ── 5-3. 로우데이터 조회 View (마스킹된 행만 anon 노출, 원본PII·해시 제외) ──
create or replace view public.cs_v_l1_rows as
select row_key, received_at, dept, channel, consult_type, status, car_no, region,
  public.cs_week_label(received_at) as week_label
from public.cs_l1;

create or replace view public.cs_v_l2_rows as
select row_key, reception_id, received_at, operator, office, route, dept, device,
  req_type, err_type, field_type, car_no, car_id, start_at, done_at, done,
  case when regexp_replace(trim(second_filter),'\s+',' ','g')='현장인계'  then '현장인계'
       when regexp_replace(trim(second_filter),'\s+',' ','g')='2차 미출동' then '2차미출동'
       else '기타' end as cat,
  public.cs_week_label(received_at) as week_label
from public.cs_l2;

-- ── 6. 권한/보안 ────────────────────────────────────────────────
alter table public.cs_l1            enable row level security;
alter table public.cs_l2            enable row level security;
alter table public.cs_weekly_insight enable row level security;

grant select on
  public.cs_v_weekly_summary, public.cs_v_daily_summary, public.cs_v_monthly_summary,
  public.cs_v_weekly_by_dept, public.cs_v_weekly_by_type, public.cs_v_weekly_by_status,
  public.cs_v_weekly_full, public.cs_v_total_summary,
  public.cs_v_recontact, public.cs_v_top_err, public.cs_v_device_model,
  public.cs_v_l1_rows, public.cs_v_l2_rows
to anon, authenticated;
