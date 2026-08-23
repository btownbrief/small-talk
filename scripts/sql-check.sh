#!/usr/bin/env bash
# Applies supabase/small-talk-SETUP.sql to a scratch local Postgres with stubbed
# auth/storage schemas and runs scripts/sql-smoke.sql. Needs postgresql@17
# running locally (brew services start postgresql@17) — it never touches the
# live project.
set -euo pipefail
DB=${DB:-st_scratch}
psql -v ON_ERROR_STOP=1 -d postgres -qc "drop database if exists $DB" -qc "create database $DB"
psql -v ON_ERROR_STOP=1 -d "$DB" -q <<'SQL'
create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
create schema auth; create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit int, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
SQL
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f supabase/small-talk-SETUP.sql
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f scripts/sql-smoke.sql
echo "sql-check: OK"
