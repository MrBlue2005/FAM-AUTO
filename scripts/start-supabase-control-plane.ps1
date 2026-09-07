param()
$ErrorActionPreference = 'Stop'
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) { throw 'Supabase CLI and Docker are required for local control-plane development.' }
supabase start
supabase db reset
supabase functions serve agent-protocol --no-verify-jwt
